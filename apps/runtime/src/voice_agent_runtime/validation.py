from __future__ import annotations

from .models import DeploymentBundle


class DeploymentValidationError(ValueError):
    pass


def validate_bundle(bundle: DeploymentBundle, *, allow_code_actions: bool = False) -> None:
    flow = bundle.flow_spec
    errors: list[str] = []
    if flow.get("schema_version") != "2.0":
        errors.append("flow_spec.schema_version must be 2.0")
    if not isinstance(flow.get("id"), str) or not flow.get("id"):
        errors.append("flow_spec.id is required")
    if not isinstance(flow.get("version"), int) or flow.get("version", 0) < 1:
        errors.append("flow_spec.version must be a positive integer")
    if flow.get("status") != "published":
        errors.append("flow_spec.status must be published")

    nodes = flow.get("nodes")
    edges = flow.get("edges")
    if not isinstance(nodes, list) or not nodes:
        errors.append("flow_spec.nodes must not be empty")
        nodes = []
    if not isinstance(edges, list):
        errors.append("flow_spec.edges must be an array")
        edges = []

    node_ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    if len(node_ids) != len(set(node_ids)):
        errors.append("node ids must be unique")
    node_id_set = {node_id for node_id in node_ids if isinstance(node_id, str)}
    entry_node_id = flow.get("entry_node_id")
    if entry_node_id not in node_id_set:
        errors.append("entry_node_id must reference an existing node")
    if not any(isinstance(node, dict) and node.get("type") == "end" for node in nodes):
        errors.append("at least one End node is required")

    edge_ids: set[str] = set()
    for edge in edges:
        if not isinstance(edge, dict):
            errors.append("every edge must be an object")
            continue
        edge_id = edge.get("id")
        if not isinstance(edge_id, str) or not edge_id:
            errors.append("every edge requires an id")
        elif edge_id in edge_ids:
            errors.append(f"duplicate edge id: {edge_id}")
        else:
            edge_ids.add(edge_id)
        if edge.get("source") not in node_id_set or edge.get("target") not in node_id_set:
            errors.append(f"edge {edge_id or '<unknown>'} references a missing node")

    tool_ids = {tool.get("id") for tool in bundle.tools if isinstance(tool, dict)}
    function_ids = {function.get("id") for function in bundle.functions if isinstance(function, dict)}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        for tool_id in node.get("tool_ids", []):
            if tool_id not in tool_ids:
                errors.append(f"node {node.get('id')} references missing tool {tool_id}")
        for binding in node.get("tool_function_bindings", []):
            if not isinstance(binding, dict):
                continue
            if binding.get("function_id") not in function_ids:
                errors.append(f"node {node.get('id')} references missing function {binding.get('function_id')}")
        runtime = node.get("runtime")
        response_mode = runtime.get("response_mode") if isinstance(runtime, dict) else node.get("response_mode")
        if response_mode == "automatic":
            errors.append(f"node {node.get('id')} uses automatic response mode, which Runtime 0.1 does not support yet")

    if not allow_code_actions:
        referenced_function_ids = {
            binding.get("function_id")
            for node in nodes
            if isinstance(node, dict)
            for binding in node.get("tool_function_bindings", [])
            if isinstance(binding, dict)
        }
        for function in bundle.functions:
            if function.get("id") not in referenced_function_ids:
                continue
            if any(action.get("type") == "code" for action in function.get("actions", [])):
                errors.append(
                    f"function {function.get('id')} uses a Python Code action; enable the isolated MVP worker with ALLOW_UNSAFE_CODE_ACTIONS=true"
                )

    state_schema_id = flow.get("state_schema_id")
    if state_schema_id and (bundle.state_schema is None or bundle.state_schema.get("id") != state_schema_id):
        errors.append("flow_spec.state_schema_id does not match state_schema")

    if errors:
        raise DeploymentValidationError("; ".join(dict.fromkeys(errors)))
