export type StateFieldType = "string" | "number" | "integer" | "boolean" | "array" | "object";
export type StateItemType = "string" | "number" | "integer" | "boolean";
export type StateUpdateMethod = "replace" | "append" | "merge" | "increment";

export interface StateField {
  id: string;
  displayName: string;
  key: string;
  description: string;
  type: StateFieldType;
  itemType?: StateItemType;
  defaultValue: unknown;
  enumValues?: Array<string | number>;
  updateMethod: StateUpdateMethod;
  readOnly: boolean;
}

export interface StateGroup {
  id: string;
  displayName: string;
  key: string;
  fields: StateField[];
}

export interface StateSchema {
  id: string;
  name: string;
  key: string;
  description: string;
  groups: StateGroup[];
  schemaVersion?: number;
  retiredFieldIds?: string[];
  updatedAt: string;
}

const fieldTypes: StateFieldType[] = ["string", "number", "integer", "boolean", "array", "object"];
const itemTypes: StateItemType[] = ["string", "number", "integer", "boolean"];
const updateMethods: StateUpdateMethod[] = ["replace", "append", "merge", "increment"];
export const STATE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export function stateKeyFromName(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function defaultStateValue(type: StateFieldType) {
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  if (type === "array") return [];
  if (type === "object") return {};
  return "";
}

function migrateField(raw: Record<string, any>, index: number): StateField {
  const type = fieldTypes.includes(raw.type) ? (raw.type as StateFieldType) : "string";
  const allowedMethod: StateUpdateMethod =
    type === "array"
      ? "append"
      : type === "object"
        ? "merge"
        : type === "number" || type === "integer"
          ? "replace"
          : "replace";
  const updateMethod = updateMethods.includes(raw.updateMethod)
    ? (raw.updateMethod as StateUpdateMethod)
    : allowedMethod;
  const enumValues = Array.isArray(raw.enumValues)
    ? raw.enumValues.filter(
        (value: unknown): value is string | number => typeof value === "string" || typeof value === "number",
      )
    : undefined;
  return {
    id: typeof raw.id === "string" ? raw.id : `field-${index + 1}`,
    displayName:
      typeof raw.displayName === "string"
        ? raw.displayName
        : typeof raw.name === "string"
          ? raw.name
          : `Field ${index + 1}`,
    key: typeof raw.key === "string" ? raw.key : `field_${index + 1}`,
    description: typeof raw.description === "string" ? raw.description : "",
    type,
    itemType:
      type === "array" && itemTypes.includes(raw.itemType)
        ? (raw.itemType as StateItemType)
        : type === "array"
          ? "string"
          : undefined,
    defaultValue: raw.defaultValue ?? defaultStateValue(type),
    enumValues,
    updateMethod,
    readOnly: raw.readOnly === true,
  };
}

function migrateGroup(raw: Record<string, any>, index: number): StateGroup {
  return {
    id: typeof raw.id === "string" ? raw.id : `group-${index + 1}`,
    displayName:
      typeof raw.displayName === "string"
        ? raw.displayName
        : typeof raw.name === "string"
          ? raw.name
          : `Object ${index + 1}`,
    key: typeof raw.key === "string" ? raw.key : `group_${index + 1}`,
    fields: (Array.isArray(raw.fields) ? raw.fields : [])
      .filter((field): field is Record<string, any> => Boolean(field) && typeof field === "object")
      .map(migrateField),
  };
}

export function migrateStateSchemas(raw: unknown, reservedKeys: string[] = []): StateSchema[] {
  if (!Array.isArray(raw)) return [];
  const usedKeys = new Set(reservedKeys.map((key) => key.toLocaleLowerCase()));
  return raw
    .filter((schema): schema is Record<string, any> => Boolean(schema) && typeof schema === "object")
    .map((schema, index) => {
      const name = typeof schema.name === "string" ? schema.name : `State ${index + 1}`;
      const baseKey =
        typeof schema.key === "string" && STATE_KEY_PATTERN.test(schema.key)
          ? schema.key
          : stateKeyFromName(name) || `state_${index + 1}`;
      let key = baseKey;
      let suffix = 2;
      while (usedKeys.has(key)) key = `${baseKey}_${suffix++}`;
      usedKeys.add(key);
      return {
        id: typeof schema.id === "string" ? schema.id : `state-${index + 1}`,
        name,
        key,
        description: typeof schema.description === "string" ? schema.description : "",
        groups: (Array.isArray(schema.groups) ? schema.groups : [])
          .filter((group): group is Record<string, any> => Boolean(group) && typeof group === "object")
          .map(migrateGroup),
        schemaVersion: typeof schema.schemaVersion === "number" ? schema.schemaVersion : 1,
        retiredFieldIds: Array.isArray(schema.retiredFieldIds)
          ? schema.retiredFieldIds.filter((id): id is string => typeof id === "string")
          : undefined,
        updatedAt: typeof schema.updatedAt === "string" ? schema.updatedAt : new Date().toISOString(),
      };
    });
}

export function createStateSchema(
  name: string,
  description: string,
  options: { id?: string; key?: string; now?: string } = {},
): StateSchema {
  return {
    id: options.id ?? `state-${crypto.randomUUID()}`,
    name: name.trim(),
    key: options.key ?? stateKeyFromName(name),
    description: description.trim(),
    groups: [],
    schemaVersion: 1,
    updatedAt: options.now ?? new Date().toISOString(),
  };
}

export function duplicateStateSchema(
  schema: StateSchema,
  existingSchemas: StateSchema[] = [],
  reservedKeys: string[] = [],
): StateSchema {
  const baseKey = `${schema.key}_copy`;
  const usedKeys = new Set([
    ...existingSchemas.map((item) => item.key),
    ...reservedKeys.map((key) => key.toLocaleLowerCase()),
  ]);
  const usedNames = new Set(existingSchemas.map((item) => item.name.trim().toLocaleLowerCase()));
  let key = baseKey;
  let name = `${schema.name} Copy`;
  let suffix = 2;
  while (usedKeys.has(key) || usedNames.has(name.toLocaleLowerCase())) {
    key = `${baseKey}_${suffix}`;
    name = `${schema.name} Copy ${suffix}`;
    suffix += 1;
  }
  return {
    ...structuredClone(schema),
    id: `state-${crypto.randomUUID()}`,
    name,
    key,
    updatedAt: new Date().toISOString(),
  };
}

export function countStateFields(schema: StateSchema) {
  return schema.groups.reduce((total, group) => total + group.fields.length, 0);
}

export function findStateField(schemas: StateSchema[], path: string) {
  const [groupKey, fieldKey] = path.split(".");
  if (!groupKey || !fieldKey) return null;
  for (const schema of schemas) {
    const group = schema.groups.find((candidate) => candidate.key === groupKey);
    const field = group?.fields.find((candidate) => candidate.key === fieldKey);
    if (field) return { schema, group: group!, field };
  }
  return null;
}
