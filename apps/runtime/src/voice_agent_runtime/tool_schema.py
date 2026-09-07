from __future__ import annotations

from typing import Any

from .bindings import BindingResolver, read_path


def _resolve_enum_entry(
    entry: Any,
    *,
    resolver: BindingResolver,
    data_assets: list[dict[str, Any]],
) -> list[Any]:
    if not isinstance(entry, dict):
        return [entry]
    kind = entry.get("kind")
    if kind == "state":
        value = resolver.resolve(f"@state.{entry.get('path', '')}")
    elif kind == "input":
        # Studio stores `path` as the complete @inputs-relative path. The
        # inputKey identifies which declared Tool Input owns the reference;
        # it is not an additional path segment. Combining both turned a
        # reference such as response_options into
        # @inputs.response_options.response_options at runtime.
        path = entry.get("path") or entry.get("inputKey", "")
        value = resolver.resolve(f"@inputs.{path}")
    elif kind == "data":
        asset = next((item for item in data_assets if item.get("id") == entry.get("dataId")), None)
        if asset is None:
            raise ValueError(f"Unknown data asset: {entry.get('dataId')}")
        content = asset.get("content", "")
        import json

        parsed = json.loads(content) if isinstance(content, str) else content
        value = read_path(parsed, str(entry.get("path", "")))
    else:
        raise ValueError(f"Unsupported enum reference: {entry}")
    return value if isinstance(value, list) else [value]


def to_realtime_tool(
    tool: dict[str, Any],
    *,
    resolver: BindingResolver,
    data_assets: list[dict[str, Any]],
) -> dict[str, Any]:
    properties: dict[str, Any] = {}
    required: list[str] = []
    for parameter in tool.get("parameters", []):
        parameter_type = parameter.get("type", "string")
        enum_values = [
            value
            for entry in parameter.get("enumValues", [])
            for value in _resolve_enum_entry(entry, resolver=resolver, data_assets=data_assets)
        ]
        schema: dict[str, Any] = {
            "type": parameter_type,
            "description": resolver.resolve(parameter.get("description", "")),
        }
        if parameter_type == "array":
            item_type = parameter.get("itemType", "string")
            schema["items"] = {"type": item_type}
            if enum_values and item_type != "boolean":
                schema["items"]["enum"] = enum_values
            if parameter.get("uniqueItems"):
                schema["uniqueItems"] = True
        elif enum_values and parameter_type != "boolean":
            schema["enum"] = enum_values
        properties[parameter["name"]] = schema
        if parameter.get("required"):
            required.append(parameter["name"])
    return {
        "type": "function",
        "name": tool["name"],
        "description": resolver.resolve(tool.get("description", "")),
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }
