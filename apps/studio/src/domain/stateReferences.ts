import type { StateReference } from "./flow";
import type { StateField, StateSchema } from "./state";
import { findStateField } from "./state";
import type { DataReferenceSuggestion } from "./dataReferences";

export const SYSTEM_STATE_FIELDS: StateField[] = [
  {
    id: "system-call-id",
    displayName: "Call ID",
    key: "call_id",
    description: "Unique identifier for the current call.",
    type: "string",
    defaultValue: "",
    updateMethod: "replace",
    readOnly: true,
  },
  {
    id: "system-current-node",
    displayName: "Current Node ID",
    key: "current_node_id",
    description: "Flow block currently being executed.",
    type: "string",
    defaultValue: "",
    updateMethod: "replace",
    readOnly: true,
  },
  {
    id: "system-turn-id",
    displayName: "Turn ID",
    key: "turn_id",
    description: "Current conversation turn sequence.",
    type: "integer",
    defaultValue: 0,
    updateMethod: "increment",
    readOnly: true,
  },
];

export function isStateReference(value: unknown): value is StateReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.kind === "state" &&
    typeof candidate.path === "string" &&
    (candidate.schemaKey === undefined || typeof candidate.schemaKey === "string")
  );
}

function previewValues(field: StateField): Array<string | number | boolean> {
  if (field.enumValues?.length) return field.enumValues;
  const value = field.defaultValue;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return [value];
  if (Array.isArray(value))
    return value.filter(
      (item): item is string | number | boolean =>
        typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
  return [];
}

function suggestion(path: string, field: StateField, schema: StateSchema): DataReferenceSuggestion {
  const valueType = field.type === "array" ? (field.itemType ?? "string") : field.type;
  return {
    expression: `@state.${path}`,
    reference: { kind: "state", schemaKey: schema.key, path },
    values: previewValues(field),
    dataName: schema.name,
    dataDescription: schema.description,
    sourceKind: "state",
    valueType,
    hint: `${field.displayName} · ${field.type}${field.defaultValue === undefined ? "" : ` · Default ${JSON.stringify(field.defaultValue)}`}`,
  };
}

export function listStateReferenceSuggestions(schemas: StateSchema[]): DataReferenceSuggestion[] {
  const suggestions: DataReferenceSuggestion[] = [];
  schemas.forEach((schema) => {
    SYSTEM_STATE_FIELDS.forEach((field) => suggestions.push(suggestion(`system.${field.key}`, field, schema)));
    schema.groups.forEach((group) =>
      group.fields.forEach((field) => suggestions.push(suggestion(`${group.key}.${field.key}`, field, schema))),
    );
  });
  return suggestions;
}

export function formatStateReference(reference: StateReference, _schemas: StateSchema[] = []) {
  return `@state.${reference.path}`;
}

export function parseStateReferenceExpression(expression: string, schemas: StateSchema[]) {
  const trimmed = expression.trim();
  const keyedSchema = schemas.find((schema) => trimmed.startsWith(`@${schema.key}.`));
  const runtimePath = trimmed.startsWith("@state.") ? trimmed.slice("@state.".length) : null;
  const path = keyedSchema ? trimmed.slice(`@${keyedSchema.key}.`.length) : runtimePath;
  if (!path) return null;
  if (path.startsWith("system.")) {
    const fieldKey = path.slice("system.".length);
    return SYSTEM_STATE_FIELDS.some((field) => field.key === fieldKey)
      ? {
          kind: "state" as const,
          ...(keyedSchema ? { schemaKey: keyedSchema.key } : {}),
          path,
        }
      : null;
  }
  const matchingSchemas = keyedSchema
    ? findStateField([keyedSchema], path)
      ? [keyedSchema]
      : []
    : schemas.filter((schema) => Boolean(findStateField([schema], path)));
  return matchingSchemas.length
    ? {
        kind: "state" as const,
        ...(keyedSchema ? { schemaKey: keyedSchema.key } : {}),
        path,
      }
    : null;
}

export function resolveStateReference(
  reference: StateReference,
  state: unknown,
): Array<string | number | boolean> | null {
  let current: unknown = state;
  for (const segment of reference.path.split(".")) {
    if (!current || typeof current !== "object" || !(segment in current)) return null;
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === "string" || typeof current === "number" || typeof current === "boolean") return [current];
  if (
    Array.isArray(current) &&
    current.every((value) => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
  )
    return current;
  return null;
}

export function stateReferenceExists(reference: StateReference, schemas: StateSchema[]) {
  const candidates = reference.schemaKey ? schemas.filter((schema) => schema.key === reference.schemaKey) : schemas;
  if (candidates.length === 0) return false;
  if (reference.path.startsWith("system."))
    return SYSTEM_STATE_FIELDS.some((field) => `system.${field.key}` === reference.path);
  return Boolean(findStateField(candidates, reference.path));
}

/** Keeps structured and inline State bindings valid when a State Schema key changes. */
export function renameStateBindingKey<T>(value: T, previousKey: string, nextKey: string): T {
  if (!previousKey || previousKey === nextKey) return value;
  if (typeof value === "string") return value.replaceAll(`@${previousKey}.`, "@state.") as T;
  if (Array.isArray(value)) return value.map((item) => renameStateBindingKey(item, previousKey, nextKey)) as T;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        key === "schemaKey" && record.kind === "state" && item === previousKey
          ? nextKey
          : renameStateBindingKey(item, previousKey, nextKey),
      ]),
    ) as T;
  }
  return value;
}

export interface StatePathRename {
  previousPath: string;
  nextPath: string;
}

export function collectStatePathRenames(previous: StateSchema, next: StateSchema): StatePathRename[] {
  const renames: StatePathRename[] = [];
  previous.groups.forEach((previousGroup) => {
    const nextGroup = next.groups.find((group) => group.id === previousGroup.id);
    if (!nextGroup) return;
    previousGroup.fields.forEach((previousField) => {
      const nextField = nextGroup.fields.find((field) => field.id === previousField.id);
      if (!nextField) return;
      const previousPath = `${previousGroup.key}.${previousField.key}`;
      const nextPath = `${nextGroup.key}.${nextField.key}`;
      if (previousPath !== nextPath) renames.push({ previousPath, nextPath });
    });
    if (previousGroup.key !== nextGroup.key) {
      renames.push({ previousPath: previousGroup.key, nextPath: nextGroup.key });
    }
  });
  return renames.sort((left, right) => right.previousPath.length - left.previousPath.length);
}

/** Keeps inline and structured @state bindings valid when Object or Field keys change. */
export function renameStateBindingPaths<T>(value: T, renames: StatePathRename[]): T {
  if (renames.length === 0) return value;
  const renamePath = (path: string) => {
    for (const rename of renames) {
      if (path === rename.previousPath || path.startsWith(`${rename.previousPath}.`)) {
        return `${rename.nextPath}${path.slice(rename.previousPath.length)}`;
      }
    }
    return path;
  };
  if (typeof value === "string") {
    let renamed: string = value;
    renames.forEach((rename) => {
      const escaped = rename.previousPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      renamed = renamed.replace(new RegExp(`@state\\.${escaped}(?=$|[^A-Za-z0-9_])`, "g"), `@state.${rename.nextPath}`);
    });
    return renamed as T;
  }
  if (Array.isArray(value)) return value.map((item) => renameStateBindingPaths(item, renames)) as T;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => [
        key,
        key === "path" && record.kind === "state" && typeof item === "string"
          ? renamePath(item)
          : renameStateBindingPaths(item, renames),
      ]),
    ) as T;
  }
  return value;
}

/** Converts schema-specific State paths to the Agent runtime alias. */
export function normalizeStateBindingAliases<T>(value: T, schemas: StateSchema[]): T {
  if (typeof value === "string") {
    let normalized: string = value;
    schemas.forEach((schema) => {
      normalized = normalized.replaceAll(`@${schema.key}.`, "@state.");
    });
    return normalized as T;
  }
  if (Array.isArray(value)) return value.map((item) => normalizeStateBindingAliases(item, schemas)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeStateBindingAliases(item, schemas),
      ]),
    ) as T;
  }
  return value;
}
