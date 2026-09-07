from __future__ import annotations

import json
import re
from copy import deepcopy
from typing import Any

DYNAMIC_STATE_SEGMENT_PATTERN = re.compile(r"\[@inputs\.([A-Za-z0-9_.]+)\]")


class BindingResolutionError(ValueError):
    pass


def _segments(path: str) -> list[str | int]:
    result: list[str | int] = []
    for name, index in re.findall(r"([^.\[\]]+)|\[(\d+)\]", path):
        result.append(int(index) if index else name)
    return result


def read_path(value: Any, path: str) -> Any:
    current = value
    if not path:
        return current
    for segment in _segments(path):
        try:
            current = current[segment]
        except (KeyError, IndexError, TypeError) as exc:
            raise BindingResolutionError(f"Binding path does not exist: {path}") from exc
    return current


def write_path(target: dict[str, Any], path: str, value: Any, method: str = "replace") -> None:
    segments = _segments(path)
    if not segments or any(isinstance(segment, int) for segment in segments):
        raise BindingResolutionError(f"State target must be an object path: {path}")
    current: dict[str, Any] = target
    for segment in segments[:-1]:
        child = current.setdefault(segment, {})
        if not isinstance(child, dict):
            raise BindingResolutionError(f"State target is not an object: {path}")
        current = child
    key = segments[-1]
    existing = current.get(key)
    if method == "replace":
        current[key] = deepcopy(value)
    elif method == "append":
        values = existing if isinstance(existing, list) else []
        current[key] = [*values, *value] if isinstance(value, list) else [*values, value]
    elif method == "merge":
        if not isinstance(value, dict):
            raise BindingResolutionError("merge requires an object value")
        current[key] = {**(existing if isinstance(existing, dict) else {}), **value}
    elif method == "increment":
        current[key] = (existing or 0) + value
    else:
        raise BindingResolutionError(f"Unsupported state update method: {method}")


class BindingResolver:
    def __init__(
        self,
        *,
        state: dict[str, Any],
        data_assets: list[dict[str, Any]],
        inputs: dict[str, Any] | None = None,
        tool_arguments: dict[str, Any] | None = None,
        outputs: dict[str, Any] | None = None,
    ) -> None:
        self.context: dict[str, Any] = {
            "state": state,
            "inputs": inputs or {},
            "tool.arguments": tool_arguments or {},
            "output": outputs or {},
        }
        for asset in data_assets:
            name = str(asset.get("name", "")).strip()
            asset_id = str(asset.get("id", "")).strip()
            content = asset.get("content", "")
            try:
                parsed = json.loads(content) if isinstance(content, str) else content
            except json.JSONDecodeError:
                parsed = content
            if name:
                self.context[name] = parsed
            if asset_id:
                self.context[asset_id] = parsed

    def resolve(self, value: Any) -> Any:
        if not isinstance(value, str) or "@" not in value:
            return deepcopy(value)
        stripped = value.strip()
        if stripped.startswith("@"):
            resolved, end = self._parse_reference(stripped, 0)
            if end == len(stripped):
                return deepcopy(resolved)

        result: list[str] = []
        cursor = 0
        while cursor < len(value):
            reference_start = value.find("@", cursor)
            if reference_start < 0:
                result.append(value[cursor:])
                break
            result.append(value[cursor:reference_start])
            resolved, reference_end = self._parse_reference(value, reference_start)
            if isinstance(resolved, (dict, list)):
                result.append(json.dumps(resolved, ensure_ascii=False))
            elif resolved is not None:
                result.append(str(resolved))
            cursor = reference_end
        return "".join(result)

    def _parse_reference(self, text: str, start: int) -> tuple[Any, int]:
        if start >= len(text) or text[start] != "@":
            raise BindingResolutionError("A binding reference must start with @.")

        root_start = start + 1
        root = next(
            (
                candidate
                for candidate in sorted(self.context, key=len, reverse=True)
                if text.startswith(candidate, root_start)
                and (root_start + len(candidate) == len(text) or text[root_start + len(candidate)] in ".[]")
            ),
            None,
        )
        if root is None:
            unknown = re.match(r"[A-Za-z][A-Za-z0-9_.-]*", text[root_start:])
            name = unknown.group(0) if unknown else text[root_start:]
            raise BindingResolutionError(f"Unknown binding root: @{name}")

        current = self.context[root]
        cursor = root_start + len(root)
        rendered_path = root
        while cursor < len(text):
            if text[cursor] == ".":
                match = re.match(r"[A-Za-z_][A-Za-z0-9_-]*", text[cursor + 1 :])
                if match is None:
                    break
                key = match.group(0)
                current = self._read_member(current, key, rendered_path)
                rendered_path = f"{rendered_path}.{key}"
                cursor += len(key) + 1
                continue

            if text.startswith("[]", cursor):
                if not isinstance(current, list):
                    raise BindingResolutionError(f"Binding path is not an array: {rendered_path}")
                rendered_path = f"{rendered_path}[]"
                cursor += 2
                continue

            if text[cursor] != "[":
                break

            if cursor + 1 < len(text) and text[cursor + 1] == "@":
                key, nested_end = self._parse_reference(text, cursor + 1)
                if nested_end >= len(text) or text[nested_end] != "]":
                    raise BindingResolutionError("Dynamic binding index is missing a closing bracket.")
                cursor = nested_end + 1
            else:
                closing = text.find("]", cursor + 1)
                if closing < 0:
                    raise BindingResolutionError("Binding index is missing a closing bracket.")
                raw_key = text[cursor + 1 : closing]
                try:
                    key = int(raw_key)
                except ValueError:
                    key = raw_key.strip("\"'")
                cursor = closing + 1
            current = self._read_member(current, key, rendered_path)
            rendered_path = f"{rendered_path}[{key}]"

        return current, cursor

    @staticmethod
    def _read_member(current: Any, key: str | int, path: str) -> Any:
        if isinstance(current, list) and isinstance(key, str):
            try:
                return [item[key] for item in current]
            except (KeyError, TypeError) as exc:
                raise BindingResolutionError(f"Binding path does not exist: {path}.{key}") from exc
        try:
            return current[key]
        except (KeyError, IndexError, TypeError) as exc:
            raise BindingResolutionError(f"Binding path does not exist: {path}[{key}]") from exc

    def resolve_state_target(self, value: str) -> str:
        def replace(match: re.Match[str]) -> str:
            resolved = read_path(self.context["inputs"], match.group(1))
            if not isinstance(resolved, str) or not resolved:
                raise BindingResolutionError("Dynamic State target keys must resolve to a string.")
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", resolved):
                raise BindingResolutionError(f"Invalid dynamic State target key: {resolved}")
            return f".{resolved}"

        target = DYNAMIC_STATE_SEGMENT_PATTERN.sub(replace, value)
        if target.startswith("@state."):
            return target[len("@state.") :]
        if target == "@state":
            raise BindingResolutionError("A State update must target a field.")
        return target
