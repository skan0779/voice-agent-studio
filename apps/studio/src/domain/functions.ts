export type FunctionValueType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface FunctionInput {
  id: string;
  displayName?: string;
  name: string;
  description: string;
  type: FunctionValueType;
  required: boolean;
}

export type FunctionActionType = "code" | "state";
export type FunctionStateUpdateMethod = "replace" | "merge" | "append" | "increment";

export interface FunctionStateUpdate {
  id: string;
  target: string;
  method: FunctionStateUpdateMethod;
  value: string;
}

export interface FunctionAction {
  id: string;
  type: FunctionActionType;
  updates: FunctionStateUpdate[];
  outputName: string;
  resultKey: string;
  code: string;
}

export interface ServiceFunction {
  id: string;
  name: string;
  key: string;
  description: string;
  inputs: FunctionInput[];
  actions: FunctionAction[];
  templateVersion?: number;
  updatedAt: string;
}

const valueTypes: FunctionValueType[] = ["string", "number", "integer", "boolean", "array", "object"];
const updateMethods: FunctionStateUpdateMethod[] = ["replace", "merge", "append", "increment"];
export const FUNCTION_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const PYTHON_RUN_PATTERN = /^\s*(?:async\s+)?def\s+run\s*\(\s*inputs\s*\)\s*:/m;
const DEFAULT_PYTHON_CODE = "return {}";

export function pythonFunctionBody(value: string) {
  const normalized = value.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const signatureIndex = lines.findIndex((line) => line.trim());
  if (signatureIndex < 0 || !/^\s*(?:async\s+)?def\s+run\s*\(\s*inputs\s*\)\s*:\s*$/.test(lines[signatureIndex])) {
    return normalized.trimEnd();
  }

  const bodyLines = lines.slice(signatureIndex + 1);
  const indentation = bodyLines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0)
    .reduce((smallest, current) => Math.min(smallest, current), Infinity);
  const removeCount = Number.isFinite(indentation) ? indentation : 0;
  return bodyLines
    .map((line) => line.slice(Math.min(removeCount, line.length)))
    .join("\n")
    .trimEnd();
}

export function composePythonFunction(body: string) {
  const normalizedBody = pythonFunctionBody(body).trimEnd() || "pass";
  return `def run(inputs):\n${normalizedBody
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n")}\n`;
}

export interface InferredPythonOutputField {
  path: string;
  type: FunctionValueType;
}

function inferredPythonValueType(value: string): FunctionValueType {
  const expression = value.trim();
  if (expression.startsWith("{") || expression.startsWith("dict(")) return "object";
  if (expression.startsWith("[") || expression.startsWith("list(")) return "array";
  if (/^(?:True|False)\b/.test(expression)) return "boolean";
  if (/^-?\d+$/.test(expression.replace(/,$/, ""))) return "integer";
  if (/^-?(?:\d+\.\d*|\d*\.\d+)\b/.test(expression)) return "number";
  if (/^["']/.test(expression)) return "string";
  return "object";
}

export function inferPythonOutputFields(code: string): InferredPythonOutputField[] {
  const lines = pythonFunctionBody(code).split("\n");
  const fields = new Map<string, FunctionValueType>();

  lines.forEach((line, returnIndex) => {
    const returnMatch = line.match(/^(\s*)return\s*\{(.*)$/);
    if (!returnMatch) return;
    const returnIndent = returnMatch[1].length;
    const inline = returnMatch[2];

    if (inline.includes("}")) {
      for (const match of inline.matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:\s*([^,}]+)/g)) {
        if (!fields.has(match[1])) fields.set(match[1], inferredPythonValueType(match[2]));
      }
      return;
    }

    const candidates: Array<{ indent: number; key: string; value: string }> = [];
    for (let index = returnIndex + 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (!candidate.trim()) continue;
      const indent = candidate.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= returnIndent) break;
      const property = candidate.match(/^\s*["']([A-Za-z_][A-Za-z0-9_]*)["']\s*:\s*(.*)$/);
      if (property) candidates.push({ indent, key: property[1], value: property[2] });
    }
    const propertyIndent = candidates.reduce((smallest, candidate) => Math.min(smallest, candidate.indent), Infinity);
    candidates
      .filter((candidate) => candidate.indent === propertyIndent)
      .forEach((candidate) => {
        if (!fields.has(candidate.key)) fields.set(candidate.key, inferredPythonValueType(candidate.value));
      });
  });

  return [...fields].map(([path, type]) => ({ path, type }));
}

export function functionKeyFromName(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createFunctionAction(type: FunctionActionType = "state"): FunctionAction {
  return {
    id: `action-${crypto.randomUUID()}`,
    type,
    updates: type === "state" ? [createFunctionStateUpdate()] : [],
    outputName: type === "code" ? "Result" : "",
    resultKey: type === "code" ? "result" : "",
    code: type === "code" ? DEFAULT_PYTHON_CODE : "",
  };
}

export function createFunctionStateUpdate(): FunctionStateUpdate {
  return {
    id: `state-update-${crypto.randomUUID()}`,
    target: "",
    method: "replace",
    value: "",
  };
}

export function createServiceFunction(
  name: string,
  description: string,
  options: { id?: string; key?: string; now?: string } = {},
): ServiceFunction {
  return {
    id: options.id ?? `function-${crypto.randomUUID()}`,
    name: name.trim(),
    key: options.key ?? functionKeyFromName(name),
    description: description.trim(),
    inputs: [],
    actions: [],
    updatedAt: options.now ?? new Date().toISOString(),
  };
}

function migrateInput(raw: Record<string, any>, index: number): FunctionInput {
  const name = typeof raw.name === "string" ? raw.name : `input_${index + 1}`;
  return {
    id: typeof raw.id === "string" ? raw.id : `input-${index + 1}`,
    displayName:
      typeof raw.displayName === "string"
        ? raw.displayName
        : name
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
    name,
    description: typeof raw.description === "string" ? raw.description : "",
    type: valueTypes.includes(raw.type) ? (raw.type as FunctionValueType) : "string",
    required: raw.required === true,
  };
}

function migrateAction(raw: Record<string, any>, index: number): FunctionAction {
  const legacyType = typeof raw.type === "string" ? raw.type : "";
  const legacyUpdateMethod: FunctionStateUpdateMethod | null =
    legacyType === "set_state"
      ? "replace"
      : legacyType === "merge_state"
        ? "merge"
        : legacyType === "append_state"
          ? "append"
          : legacyType === "increment_state"
            ? "increment"
            : null;
  const type: FunctionActionType =
    legacyType === "code" ||
    legacyType === "handler" ||
    legacyType === "run_handler" ||
    legacyType === "initialize_assessment" ||
    legacyType === "evaluate_assessment"
      ? "code"
      : "state";
  const legacyHandlerKey =
    typeof raw.handlerKey === "string"
      ? raw.handlerKey
      : legacyType === "initialize_assessment"
        ? "assessment.initialize"
        : legacyType === "evaluate_assessment"
          ? "assessment.evaluate"
          : "";
  const resultKey =
    typeof raw.resultKey === "string" && raw.resultKey ? raw.resultKey : type === "code" ? "result" : "";
  const migrateUpdate = (update: Record<string, any>, updateIndex: number): FunctionStateUpdate => ({
    id: typeof update.id === "string" ? update.id : `state-update-${index + 1}-${updateIndex + 1}`,
    target: typeof update.target === "string" ? update.target.replaceAll("@input.", "@inputs.") : "",
    method: updateMethods.includes(update.method)
      ? (update.method as FunctionStateUpdateMethod)
      : updateMethods.includes(update.updateMethod)
        ? (update.updateMethod as FunctionStateUpdateMethod)
        : (legacyUpdateMethod ?? "replace"),
    value: typeof update.value === "string" ? update.value.replaceAll("@input.", "@inputs.") : "",
  });
  const rawUpdates = Array.isArray(raw.updates)
    ? raw.updates.filter((update): update is Record<string, any> => Boolean(update) && typeof update === "object")
    : [];
  return {
    id: typeof raw.id === "string" ? raw.id : `action-${index + 1}`,
    type,
    updates: type === "state" ? (rawUpdates.length ? rawUpdates.map(migrateUpdate) : [migrateUpdate(raw, 0)]) : [],
    outputName:
      typeof raw.outputName === "string" && raw.outputName
        ? raw.outputName
        : resultKey
            .split("_")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
    resultKey,
    code:
      typeof raw.code === "string"
        ? pythonFunctionBody(raw.code)
        : legacyHandlerKey
          ? `# Replace the migrated registered handler: ${legacyHandlerKey}\n`
          : "",
  };
}

export function migrateFunctions(raw: unknown): ServiceFunction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const rawActions = (Array.isArray(item.actions) ? item.actions : []).filter(
        (action): action is Record<string, any> => Boolean(action) && typeof action === "object",
      );
      const actions = rawActions
        .filter((action) => !["return", "read_data", "set_variable", "condition"].includes(action.type))
        .map(migrateAction);
      const outputKeys = actions
        .filter((action) => action.type === "code")
        .map((action) => action.resultKey)
        .filter(Boolean);
      return {
        id: typeof item.id === "string" ? item.id : `function-${index + 1}`,
        name: typeof item.name === "string" ? item.name : `Function ${index + 1}`,
        key:
          typeof item.key === "string" && FUNCTION_KEY_PATTERN.test(item.key)
            ? item.key
            : functionKeyFromName(item.name ?? "") || `function_${index + 1}`,
        description: typeof item.description === "string" ? item.description : "",
        inputs: (Array.isArray(item.inputs) ? item.inputs : [])
          .filter((input): input is Record<string, any> => Boolean(input) && typeof input === "object")
          .map(migrateInput),
        actions: actions.map((action) =>
          action.type === "state"
            ? {
                ...action,
                updates: action.updates.map((update) => ({
                  ...update,
                  value: outputKeys.reduce((value, key) => value.replaceAll(`@${key}`, `@output.${key}`), update.value),
                })),
              }
            : action,
        ),
        templateVersion: typeof item.templateVersion === "number" ? item.templateVersion : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      };
    });
}

export function duplicateServiceFunction(source: ServiceFunction, functions: ServiceFunction[]): ServiceFunction {
  const usedNames = new Set(functions.map((item) => item.name.toLocaleLowerCase()));
  const usedKeys = new Set(functions.map((item) => item.key));
  let suffix = 1;
  let name = `${source.name} Copy`;
  let key = `${source.key}_copy`;
  while (usedNames.has(name.toLocaleLowerCase()) || usedKeys.has(key)) {
    suffix += 1;
    name = `${source.name} Copy ${suffix}`;
    key = `${source.key}_copy_${suffix}`;
  }
  return {
    ...structuredClone(source),
    id: `function-${crypto.randomUUID()}`,
    name,
    key,
    templateVersion: undefined,
    updatedAt: new Date().toISOString(),
  };
}

export function functionActionComplete(action: FunctionAction) {
  if (action.type === "state") {
    const targets = action.updates.map((update) => update.target.trim());
    return Boolean(
      action.updates.length > 0 &&
      action.updates.every(
        (update) => update.target.trim() && update.value.trim() && updateMethods.includes(update.method),
      ) &&
      new Set(targets).size === targets.length,
    );
  }
  if (action.type === "code") {
    const hasExecutableBody = action.code
      .split(/\r?\n/)
      .some((line) => Boolean(line.trim()) && !line.trimStart().startsWith("#"));
    return Boolean(
      FUNCTION_KEY_PATTERN.test(action.resultKey) && hasExecutableBody && !PYTHON_RUN_PATTERN.test(action.code),
    );
  }
  return false;
}
