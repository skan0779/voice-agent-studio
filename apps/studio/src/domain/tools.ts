import type {
  ToolDefinition,
  ToolEnumValue,
  ToolInput,
  ToolInputType,
  ToolParameter,
  ToolParameterItemType,
  ToolParameterType,
} from "./flow";
import type { DataAsset } from "./workspaces";
import { isDataReference, isInputReference, resolveDataReference } from "./dataReferences";
import { isStateReference, resolveStateReference } from "./stateReferences";

const parameterTypes: ToolParameterType[] = ["string", "number", "integer", "boolean", "array"];
const itemTypes: ToolParameterItemType[] = ["string", "number", "integer", "boolean"];
const inputTypes: ToolInputType[] = ["string", "number", "integer", "boolean", "array", "object"];
function enumValues(raw: Record<string, any>): ToolEnumValue[] {
  const values = Array.isArray(raw.enumValues)
    ? raw.enumValues
    : Array.isArray(raw.options)
      ? raw.options
      : Array.isArray(raw.enum)
        ? raw.enum
        : Array.isArray(raw.items?.enum)
          ? raw.items.enum
          : [];
  return values.filter(
    (value: unknown): value is ToolEnumValue =>
      typeof value === "string" ||
      typeof value === "number" ||
      isDataReference(value) ||
      isStateReference(value) ||
      isInputReference(value),
  );
}

function parameterValueType(parameter: ToolParameter) {
  return parameter.type === "array" ? (parameter.itemType ?? "string") : parameter.type;
}

function resolveInputReferenceValue(
  reference: Extract<ToolEnumValue, { kind: "input" }>,
  inputs: Record<string, unknown>,
) {
  let current: unknown = inputs;
  const segments = reference.path.split(".").filter(Boolean);
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  const values = Array.isArray(current) ? current : [current];
  return values.filter(
    (value): value is string | number | boolean =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean",
  );
}

export function resolveToolEnumValues(
  parameter: ToolParameter,
  assets: DataAsset[] = [],
  state: unknown = {},
  inputs: Record<string, unknown> = {},
) {
  const type = parameterValueType(parameter);
  return (parameter.enumValues ?? []).flatMap((entry) => {
    const values = isDataReference(entry)
      ? resolveDataReference(entry, assets, state)
      : isStateReference(entry)
        ? resolveStateReference(entry, state)
        : isInputReference(entry)
          ? resolveInputReferenceValue(entry, inputs)
          : [entry];
    if (!values) throw new Error(`Unresolved binding reference in parameter ${parameter.name}.`);
    return values.map((value) => (type === "number" || type === "integer" ? Number(value) : String(value)));
  });
}

function migrateInput(raw: Record<string, any>, index: number): ToolInput {
  return {
    id: typeof raw.id === "string" ? raw.id : `input-${index + 1}`,
    displayName: typeof raw.displayName === "string" ? raw.displayName : undefined,
    name: typeof raw.name === "string" ? raw.name : `input_${index + 1}`,
    description: typeof raw.description === "string" ? raw.description : "",
    type: inputTypes.includes(raw.type) ? (raw.type as ToolInputType) : "string",
    required: raw.required === true,
  };
}

function migrateParameter(raw: Record<string, any>, index: number): ToolParameter {
  const rawType = parameterTypes.includes(raw.type) ? (raw.type as ToolParameterType) : "string";
  const parameterName =
    typeof raw.name === "string" ? raw.name : typeof raw.id === "string" ? raw.id : `parameter_${index + 1}`;
  const type = rawType;
  return {
    id: typeof raw.id === "string" ? raw.id : `parameter-${index + 1}`,
    name: parameterName,
    description: typeof raw.description === "string" ? raw.description : typeof raw.label === "string" ? raw.label : "",
    type,
    required: raw.required === true,
    enumValues: enumValues(raw),
    itemType:
      type === "array" && itemTypes.includes(raw.itemType ?? raw.items?.type)
        ? ((raw.itemType ?? raw.items.type) as ToolParameterItemType)
        : undefined,
    uniqueItems: type === "array" ? raw.uniqueItems === true : undefined,
  };
}

export function migrateTools(raw: unknown): ToolDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const displayName =
        typeof item.displayName === "string"
          ? item.displayName
          : typeof item.name === "string"
            ? item.name
            : `Tool ${index + 1}`;
      return {
        id: typeof item.id === "string" ? item.id : `tool-${index + 1}`,
        name: typeof item.name === "string" ? item.name : `tool_${index + 1}`,
        displayName,
        description: typeof item.description === "string" ? item.description : "",
        inputs: (Array.isArray(item.inputs) ? item.inputs : [])
          .filter((input): input is Record<string, any> => Boolean(input) && typeof input === "object")
          .map(migrateInput),
        parameters: (Array.isArray(item.parameters) ? item.parameters : Array.isArray(item.fields) ? item.fields : [])
          .filter((parameter): parameter is Record<string, any> => Boolean(parameter) && typeof parameter === "object")
          .map(migrateParameter),
        templateVersion: typeof item.templateVersion === "number" ? item.templateVersion : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      };
    });
}

export function toRealtimeTool(
  tool: ToolDefinition,
  assets: DataAsset[] = [],
  state: unknown = {},
  inputs: Record<string, unknown> = {},
) {
  const properties = Object.fromEntries(
    tool.parameters.map((parameter) => {
      const resolvedValues = resolveToolEnumValues(parameter, assets, state, inputs);
      const enumValues = resolvedValues.length ? resolvedValues : undefined;
      if (parameter.type === "array") {
        return [
          parameter.name,
          {
            type: "array",
            description: parameter.description,
            items: {
              type: parameter.itemType ?? "string",
              ...(parameter.itemType !== "boolean" && enumValues ? { enum: enumValues } : {}),
            },
            ...(parameter.uniqueItems ? { uniqueItems: true } : {}),
          },
        ];
      }
      return [
        parameter.name,
        {
          type: parameter.type,
          description: parameter.description,
          ...(parameter.type !== "boolean" && enumValues ? { enum: enumValues } : {}),
        },
      ];
    }),
  );
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: {
      type: "object" as const,
      properties,
      required: tool.parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
      additionalProperties: false,
    },
  };
}
