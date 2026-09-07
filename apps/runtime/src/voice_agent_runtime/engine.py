from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any

from .bindings import BindingResolutionError, BindingResolver, read_path, write_path
from .code_actions import run_python_action
from .models import DeploymentBundle
from .tool_schema import to_realtime_tool

DIRECT_TOOL_ARGUMENT_PATTERN = re.compile(r"^@tool\.arguments\.([A-Za-z_][A-Za-z0-9_-]*)(?:[.\[].*)?$")


def initial_state(schema: dict[str, Any] | None) -> dict[str, Any]:
    if not schema:
        return {}
    return {
        group["key"]: {field["key"]: deepcopy(field.get("defaultValue")) for field in group.get("fields", [])}
        for group in schema.get("groups", [])
    }


def parse_literal(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    normalized = value.strip()
    if normalized.lower() == "true":
        return True
    if normalized.lower() == "false":
        return False
    if normalized.lower() in {"null", "none"}:
        return None
    try:
        return json.loads(normalized)
    except json.JSONDecodeError:
        return value


def compare(left: Any, comparator: str, right: Any) -> bool:
    if comparator == "equals":
        return left == right
    if comparator == "not_equals":
        return left != right
    if comparator == "contains":
        try:
            return right in left
        except TypeError:
            return False
    if comparator == "greater_than":
        return left > right
    if comparator == "greater_or_equal":
        return left >= right
    if comparator == "less_than":
        return left < right
    if comparator == "less_or_equal":
        return left <= right
    raise ValueError(f"Unsupported comparator: {comparator}")


@dataclass(slots=True)
class FlowEngine:
    bundle: DeploymentBundle
    allow_unsafe_code_actions: bool = False
    state: dict[str, Any] = field(init=False)
    current_node_id: str = field(init=False)
    outputs: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.state = initial_state(self.bundle.state_schema)
        self.current_node_id = self.bundle.flow_spec["entry_node_id"]

    @property
    def flow(self) -> dict[str, Any]:
        return self.bundle.flow_spec

    @property
    def current_node(self) -> dict[str, Any]:
        return self.node(self.current_node_id)

    @property
    def is_complete(self) -> bool:
        return self.current_node.get("type") == "end"

    def node(self, node_id: str) -> dict[str, Any]:
        node = next((item for item in self.flow["nodes"] if item.get("id") == node_id), None)
        if node is None:
            raise ValueError(f"Unknown node: {node_id}")
        return node

    def enter_first_node(self) -> dict[str, Any]:
        if self.current_node.get("type") == "start":
            self.route()
        self.advance_passive_nodes()
        return self.current_node

    def advance_passive_nodes(self) -> dict[str, Any]:
        visited: set[str] = set()
        while (
            self.current_node.get("type") == "node"
            and self.current_node.get("response_mode", self.current_node.get("runtime", {}).get("response_mode"))
            == "none"
        ):
            if self.current_node_id in visited:
                raise ValueError(f"Passive node cycle detected at {self.current_node_id}")
            visited.add(self.current_node_id)
            previous = self.current_node_id
            self.route()
            if self.current_node_id == previous:
                break
        return self.current_node

    def resolver(
        self,
        *,
        inputs: dict[str, Any] | None = None,
        tool_arguments: dict[str, Any] | None = None,
    ) -> BindingResolver:
        return BindingResolver(
            state=self.state,
            data_assets=self.bundle.data_assets,
            inputs=inputs,
            tool_arguments=tool_arguments,
            outputs=self.outputs,
        )

    def render_instructions(self, note: str | None = None) -> str:
        start_instructions = self.flow.get("start", {}).get("session_update", {}).get("instructions", "")
        node_instructions = self.current_node.get("instructions", "")
        combined = "\n\n".join(part for part in (start_instructions, node_instructions, note) if part)
        return str(self.resolver().resolve(combined))

    def realtime_tools(self) -> list[dict[str, Any]]:
        tools_by_id = {tool.get("id"): tool for tool in self.bundle.tools}
        node_inputs = {
            item.get("tool_id"): item.get("input_mapping", {})
            for item in self.current_node.get("tool_input_bindings", [])
        }
        result: list[dict[str, Any]] = []
        for tool_id in self.current_node.get("tool_ids", []):
            tool = tools_by_id.get(tool_id)
            if not tool:
                continue
            inputs = {key: self.resolver().resolve(value) for key, value in node_inputs.get(tool_id, {}).items()}
            result.append(
                to_realtime_tool(
                    tool,
                    resolver=self.resolver(inputs=inputs),
                    data_assets=self.bundle.data_assets,
                )
            )
        return result

    def execute_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = next((item for item in self.bundle.tools if item.get("name") == tool_name), None)
        if tool is None or tool.get("id") not in self.current_node.get("tool_ids", []):
            raise ValueError(f"Tool is not available in the current node: {tool_name}")
        binding = next(
            (
                item
                for item in self.current_node.get("tool_function_bindings", [])
                if item.get("tool_id") == tool.get("id")
            ),
            None,
        )
        if binding is None:
            return {"ok": True, "tool": tool_name, "arguments": arguments}
        function = next(
            (item for item in self.bundle.functions if item.get("id") == binding.get("function_id")),
            None,
        )
        if function is None:
            raise ValueError(f"Bound function does not exist: {binding.get('function_id')}")
        inputs: dict[str, Any] = {}
        argument_resolver = self.resolver(tool_arguments=arguments)
        for key, value in binding.get("input_mapping", {}).items():
            try:
                inputs[key] = argument_resolver.resolve(value)
            except BindingResolutionError:
                direct_argument = DIRECT_TOOL_ARGUMENT_PATTERN.fullmatch(value) if isinstance(value, str) else None
                if direct_argument and direct_argument.group(1) not in arguments:
                    # Optional Tool arguments are legitimately omitted by the
                    # model. Leave the corresponding Function input absent;
                    # the Function's own required-input validation below is
                    # the source of truth.
                    continue
                raise
        missing = [
            item.get("name")
            for item in function.get("inputs", [])
            if item.get("required") and item.get("name") not in inputs
        ]
        if missing:
            raise ValueError(f"Missing required function inputs: {', '.join(missing)}")
        self._execute_function(function, inputs)
        self.route()
        self.advance_passive_nodes()
        return {"ok": True, "tool": tool_name, "state": deepcopy(self.state)}

    def _execute_function(self, function: dict[str, Any], inputs: dict[str, Any]) -> None:
        for action in function.get("actions", []):
            if action.get("type") == "code":
                if not self.allow_unsafe_code_actions:
                    raise RuntimeError(
                        "Python Code actions are disabled. Set ALLOW_UNSAFE_CODE_ACTIONS=true only for local MVP use."
                    )
                result_key = str(action.get("resultKey", "") or action.get("result_key", ""))
                if not result_key:
                    raise ValueError("A Python Code action requires an output key.")
                self.outputs[result_key] = run_python_action(str(action.get("code", "")), inputs)
                continue
            if action.get("type") != "state":
                continue
            resolver = self.resolver(inputs=inputs)
            for update in action.get("updates", []):
                target = resolver.resolve_state_target(str(update.get("target", "")))
                value = parse_literal(resolver.resolve(update.get("value")))
                write_path(self.state, target, value, str(update.get("method", "replace")))

    def route(self, *, elapsed_ms: int = 0) -> dict[str, Any]:
        outgoing = [edge for edge in self.flow.get("edges", []) if edge.get("source") == self.current_node_id]
        matched = [
            edge
            for edge in outgoing
            if edge.get("route_type") == "condition" and self._condition_matches(edge.get("condition", {}), elapsed_ms)
        ]
        always = [edge for edge in outgoing if edge.get("route_type") == "always"]
        fallback = [edge for edge in outgoing if edge.get("route_type") == "fallback"]
        candidates = matched or always or fallback
        if not candidates:
            return self.current_node
        candidates.sort(key=lambda edge: (edge.get("priority", 1), edge.get("id", "")))
        if len(candidates) > 1 and candidates[0].get("priority", 1) == candidates[1].get("priority", 1):
            raise ValueError(f"Ambiguous edges from node {self.current_node_id}")
        self.current_node_id = candidates[0]["target"]
        return self.current_node

    def _condition_matches(self, condition: dict[str, Any], elapsed_ms: int) -> bool:
        results: list[bool] = []
        for rule in condition.get("rules", []):
            if rule.get("kind") == "timeout":
                results.append(elapsed_ms >= int(rule.get("timeout_ms", 0)))
                continue
            path = str(rule.get("path", ""))
            if path.startswith("@state."):
                path = path[len("@state.") :]
            try:
                left = read_path(self.state, path)
                right = self.resolver().resolve(rule.get("value", ""))
                right = parse_literal(right)
                results.append(compare(left, str(rule.get("comparator", "equals")), right))
            except (BindingResolutionError, TypeError, ValueError):
                results.append(False)
        if not results:
            return False
        return all(results) if condition.get("logic") == "all" else any(results)

    def snapshot(self) -> dict[str, Any]:
        return {
            "current_node_id": self.current_node_id,
            "state": deepcopy(self.state),
            "complete": self.is_complete,
        }
