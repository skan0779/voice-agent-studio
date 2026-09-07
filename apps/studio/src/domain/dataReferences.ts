import type { DataReference, InputReference, StateReference } from "./flow";
import type { DataAsset } from "./workspaces";

export interface OutputReference {
  kind: "output";
  outputKey: string;
  path: string;
}

export interface ToolArgumentReference {
  kind: "tool";
  toolId: string;
  path: string;
}

export interface DataReferenceSuggestion {
  expression: string;
  reference: DataReference | StateReference | OutputReference | InputReference | ToolArgumentReference;
  values: Array<string | number | boolean>;
  dataName?: string;
  dataDescription?: string;
  sourceKind?: "data" | "state" | "input" | "output" | "tool";
  valueType?: "string" | "number" | "integer" | "boolean" | "array" | "object";
  hint?: string;
  menuHidden?: boolean;
}

export function isDataReference(value: unknown): value is DataReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "data" && typeof candidate.dataId === "string" && typeof candidate.path === "string";
}

export function isInputReference(value: unknown): value is InputReference {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === "input" && typeof candidate.inputKey === "string" && typeof candidate.path === "string";
}

function parseJsonAsset(asset: DataAsset): unknown | null {
  if (asset.format !== "JSON" || !asset.content.trim()) return null;
  try {
    return JSON.parse(asset.content);
  } catch {
    return null;
  }
}

function collectPaths(
  value: unknown,
  exactPath: string,
  wildcardPath: string,
  paths: Map<string, Array<string | number | boolean>>,
) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    for (const path of new Set([exactPath, wildcardPath])) {
      if (!path) continue;
      const values = paths.get(path) ?? [];
      if (!values.some((candidate) => candidate === value)) values.push(value);
      paths.set(path, values);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectPaths(item, `${exactPath}[${index}]`, `${wildcardPath}[]`, paths);
    });
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => {
      collectPaths(
        child,
        exactPath ? `${exactPath}.${key}` : key,
        wildcardPath ? `${wildcardPath}.${key}` : key,
        paths,
      );
    });
  }
}

export function listDataReferenceSuggestions(assets: DataAsset[]): DataReferenceSuggestion[] {
  return assets.flatMap((asset) => {
    const parsed = parseJsonAsset(asset);
    if (parsed === null) return [];
    const paths = new Map<string, Array<string | number | boolean>>();
    collectPaths(parsed, "", "", paths);
    return [...paths.entries()].map(([path, values]) => ({
      expression: `@${asset.name}.${path}`,
      reference: { kind: "data" as const, dataId: asset.id, path },
      values,
      dataName: asset.name,
      dataDescription: asset.description,
      sourceKind: "data" as const,
      valueType: values.every((value) => typeof value === "number")
        ? ("number" as const)
        : values.every((value) => typeof value === "boolean")
          ? ("boolean" as const)
          : ("string" as const),
    }));
  });
}

export function formatDataReference(reference: DataReference, assets: DataAsset[]) {
  const asset = assets.find((candidate) => candidate.id === reference.dataId);
  return `@${asset?.name ?? reference.dataId}.${reference.path}`;
}

export function parseDataReferenceExpression(expression: string, assets: DataAsset[]) {
  const exact = listDataReferenceSuggestions(assets).find(
    (suggestion) => suggestion.expression === expression,
  )?.reference;
  if (exact?.kind === "data") return exact;
  const asset = [...assets]
    .sort((left, right) => right.name.length - left.name.length)
    .find((candidate) => expression.startsWith(`@${candidate.name}.`));
  if (!asset) return null;
  const path = expression.slice(asset.name.length + 2);
  return path && parseBindingPath(path) ? { kind: "data" as const, dataId: asset.id, path } : null;
}

type BindingPathSegment =
  | { kind: "property"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "dynamic"; expression: string };

function matchingBracket(value: string, start: number) {
  let depth = 0;
  for (let index = start; index < value.length; index += 1) {
    if (value[index] === "[") depth += 1;
    if (value[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseBindingPath(path: string): BindingPathSegment[] | null {
  const segments: BindingPathSegment[] = [];
  let cursor = 0;
  while (cursor < path.length) {
    if (path[cursor] === ".") {
      cursor += 1;
      continue;
    }
    if (path[cursor] === "[") {
      const end = matchingBracket(path, cursor);
      if (end < 0) return null;
      const selector = path.slice(cursor + 1, end);
      if (!selector) segments.push({ kind: "wildcard" });
      else if (/^\d+$/.test(selector)) segments.push({ kind: "index", index: Number(selector) });
      else if (selector.startsWith("@")) segments.push({ kind: "dynamic", expression: selector });
      else return null;
      cursor = end + 1;
      continue;
    }
    const match = path.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_-]*/);
    if (!match) return null;
    segments.push({ kind: "property", key: match[0] });
    cursor += match[0].length;
  }
  return segments.length ? segments : null;
}

function parseBindingRoot(expression: string, assets: DataAsset[]) {
  const asset = [...assets]
    .sort((left, right) => right.name.length - left.name.length)
    .find((candidate) => expression.startsWith(`@${candidate.name}.`));
  if (asset) return { root: parseJsonAsset(asset), path: expression.slice(asset.name.length + 2) };
  const match = expression.match(/^@[a-z][a-z0-9_]*\.(.+)$/);
  return match ? { root: undefined, path: match[1] } : null;
}

function resolveBindingExpression(expression: string, assets: DataAsset[], state: unknown): unknown[] | null {
  const parsed = parseBindingRoot(expression, assets);
  if (!parsed) return null;
  const segments = parseBindingPath(parsed.path);
  if (!segments) return null;
  const root = parsed.root === undefined ? state : parsed.root;
  if (root === null || root === undefined) return null;

  const visit = (current: unknown, index: number): unknown[] | null => {
    if (index >= segments.length) return [current];
    const segment = segments[index];
    if (segment.kind === "wildcard") {
      if (!Array.isArray(current)) return null;
      const values = current.flatMap((item) => visit(item, index + 1) ?? []);
      return values;
    }
    if (segment.kind === "index") {
      if (!Array.isArray(current) || segment.index >= current.length) return null;
      return visit(current[segment.index], index + 1);
    }
    if (segment.kind === "dynamic") {
      const selectors = resolveBindingExpression(segment.expression, assets, state);
      if (!selectors?.length) return null;
      const values = selectors.flatMap((selector) => {
        if (Array.isArray(current)) {
          const numeric = typeof selector === "number" ? selector : Number(selector);
          return Number.isInteger(numeric) && numeric >= 0 && numeric < current.length
            ? (visit(current[numeric], index + 1) ?? [])
            : [];
        }
        if (!current || typeof current !== "object") return [];
        const key = String(selector);
        return key in current ? (visit((current as Record<string, unknown>)[key], index + 1) ?? []) : [];
      });
      return values.length ? values : null;
    }
    if (!current || typeof current !== "object" || !(segment.key in current)) return null;
    return visit((current as Record<string, unknown>)[segment.key], index + 1);
  };

  return visit(root, 0);
}

export function isIndirectDataReference(reference: DataReference) {
  return reference.path.includes("[@");
}

export function resolveDataReference(reference: DataReference, assets: DataAsset[], state: unknown = {}) {
  const asset = assets.find((candidate) => candidate.id === reference.dataId);
  if (!asset) return null;
  return (
    resolveBindingExpression(`@${asset.name}.${reference.path}`, assets, state)?.filter(
      (value): value is string | number | boolean =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean",
    ) ?? null
  );
}
