import { Braces, Database, MemoryStick, Wrench } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { DataReferenceSuggestion } from "../../domain/dataReferences";
import { cn } from "../../lib/cn";

interface ReferenceQuery {
  start: number;
  end: number;
  query: string;
  dynamicParents?: Array<{
    start: number;
    continuation: "" | "." | "[";
  }>;
}

export type ReferenceTextPart =
  { kind: "text"; value: string } | { kind: "reference"; value: string; suggestion: DataReferenceSuggestion };

function indirectSuggestions(value: string, suggestions: DataReferenceSuggestion[]) {
  const roots = new Map<string, DataReferenceSuggestion>();
  suggestions.forEach((suggestion) => {
    if (suggestion.reference.kind !== "data") return;
    const label = suggestionLabel(suggestion);
    if (!roots.has(label.dataName)) roots.set(label.dataName, suggestion);
  });
  const matches: DataReferenceSuggestion[] = [];
  [...roots.entries()]
    .sort(([left], [right]) => right.length - left.length)
    .forEach(([root, seed]) => {
      const prefix = `@${root}.`;
      let from = 0;
      while (from < value.length) {
        const start = value.indexOf(prefix, from);
        if (start < 0) break;
        let cursor = start + prefix.length;
        let depth = 0;
        while (cursor < value.length) {
          const character = value[cursor];
          if (character === "[") depth += 1;
          else if (character === "]") depth -= 1;
          else if (depth === 0 && !/[A-Za-z0-9_.-]/.test(character)) break;
          cursor += 1;
        }
        const expression = value.slice(start, cursor).replace(/\.$/, "");
        if (expression.includes("[@") && expression.split("[").length === expression.split("]").length) {
          matches.push({
            ...seed,
            expression,
            reference: {
              kind: "data",
              dataId: seed.reference.kind === "data" ? seed.reference.dataId : "",
              path: expression.slice(prefix.length),
            },
            values: [],
            hint: "Resolved from Data and State at runtime",
          });
        }
        from = Math.max(cursor, start + prefix.length);
      }
    });
  const stateSeed = suggestions.find((suggestion) => suggestion.reference.kind === "state");
  if (stateSeed) {
    const prefix = "@state[";
    let from = 0;
    while (from < value.length) {
      const start = value.indexOf(prefix, from);
      if (start < 0) break;
      const bracketStart = start + "@state".length;
      const bracketEnd = matchingSelectorEnd(value, bracketStart);
      if (bracketEnd < 0) break;
      let cursor = bracketEnd + 1;
      while (cursor < value.length && /[A-Za-z0-9_.-]/.test(value[cursor])) cursor += 1;
      const expression = value.slice(start, cursor).replace(/\.$/, "");
      if (expression.includes("[@") && expression.includes("].")) {
        matches.push({
          ...stateSeed,
          expression,
          reference: {
            kind: "state",
            path: expression.slice("@state".length),
          },
          values: [],
          hint: "State Object resolved from Function inputs at runtime",
        });
      }
      from = Math.max(cursor, bracketEnd + 1);
    }
  }
  return matches;
}

export function splitReferenceText(value: string, suggestions: DataReferenceSuggestion[]): ReferenceTextPart[] {
  const dynamicSuggestions = indirectSuggestions(value, suggestions);
  const expressions = [...dynamicSuggestions, ...suggestions].sort((a, b) => b.expression.length - a.expression.length);
  const parts: ReferenceTextPart[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let next: { index: number; suggestion: DataReferenceSuggestion } | null = null;
    expressions.forEach((suggestion) => {
      const index = value.indexOf(suggestion.expression, cursor);
      if (index < 0 || (next && index > next.index)) return;
      if (!next || index < next.index || suggestion.expression.length > next.suggestion.expression.length)
        next = { index, suggestion };
    });
    if (!next) {
      parts.push({ kind: "text", value: value.slice(cursor) });
      break;
    }
    const match = next as { index: number; suggestion: DataReferenceSuggestion };
    if (match.index > cursor) parts.push({ kind: "text", value: value.slice(cursor, match.index) });
    parts.push({ kind: "reference", value: match.suggestion.expression, suggestion: match.suggestion });
    cursor = match.index + match.suggestion.expression.length;
  }
  return parts;
}

export function findReferenceQuery(value: string, caret: number): ReferenceQuery | null {
  const beforeCaret = value.slice(0, caret);
  const start = beforeCaret.lastIndexOf("@");
  if (start < 0 || (start > 0 && /[\w@]/.test(beforeCaret[start - 1]))) return null;
  const query = beforeCaret.slice(start + 1);
  if (/\n/.test(query)) return null;
  const dynamicParentStart = start > 0 && beforeCaret[start - 1] === "[" ? beforeCaret.lastIndexOf("@", start - 1) : -1;
  return {
    start,
    end: caret,
    query,
    ...(dynamicParentStart >= 0 ? { dynamicParents: [{ start: dynamicParentStart, continuation: "." as const }] } : {}),
  };
}

export function insertReference(value: string, query: ReferenceQuery, expression: string) {
  const nextValue = `${value.slice(0, query.start)}${expression}${value.slice(query.end)}`;
  return { value: nextValue, caret: query.start + expression.length };
}

function suggestionLabel(suggestion: DataReferenceSuggestion) {
  const pathSuffix = `.${suggestion.reference.path}`;
  return {
    dataName: suggestion.expression.slice(1, -pathSuffix.length),
    path: suggestion.reference.path,
  };
}

export type DataReferenceMenuOption =
  | {
      kind: "data";
      dataId: string;
      dataName: string;
      bindingName?: string;
      description: string;
      sourceKind?: "data" | "state" | "input" | "output" | "tool";
    }
  | {
      kind: "path";
      dataId: string;
      dataName: string;
      bindingName?: string;
      segment: string;
      fullPath: string;
      isLeaf: boolean;
      dynamicSelector?: "index" | "key";
      dynamicContinuation?: "" | "." | "[";
      wildcard?: boolean;
      suggestion?: DataReferenceSuggestion;
      sourceKind?: "data" | "state" | "input" | "output" | "tool";
    };

interface JsonPathToken {
  kind: "property" | "index";
  label: string;
}

function tokenizeJsonPath(path: string): JsonPathToken[] {
  const tokens: JsonPathToken[] = [];
  for (const match of path.matchAll(/([^.[\]]+)|\[([^\]]*)]/g)) {
    if (match[1]) tokens.push({ kind: "property", label: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "index", label: match[2] });
  }
  return tokens;
}

function matchingSelectorEnd(value: string, start: number) {
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

function canonicalBindingExpression(expression: string) {
  let result = "";
  for (let index = 0; index < expression.length; index += 1) {
    if (expression[index] === "[" && expression[index + 1] === "@") {
      const end = matchingSelectorEnd(expression, index);
      if (end < 0) return expression;
      result += "[]";
      index = end;
    } else result += expression[index];
  }
  return result;
}

function bindingValues(expression: string, suggestions: DataReferenceSuggestion[]) {
  const exact = suggestions.find((suggestion) => suggestion.expression === expression);
  if (exact) return exact.values;
  const canonical = canonicalBindingExpression(expression);
  return suggestions.find((suggestion) => suggestion.expression === canonical)?.values ?? [];
}

function expandDynamicPathQueries(
  path: string,
  groupSuggestions: DataReferenceSuggestion[],
  allSuggestions: DataReferenceSuggestion[],
): string[] {
  const start = path.indexOf("[@");
  if (start < 0) return [path];
  const end = matchingSelectorEnd(path, start);
  if (end < 0) return [path];
  const prefix = path.slice(0, start);
  const selector = path.slice(start + 1, end);
  const suffix = path.slice(end + 1);
  const arraySelector = groupSuggestions.some((suggestion) => suggestion.reference.path.startsWith(`${prefix}[`));
  let replacements: Array<string | number | boolean>;
  if (arraySelector) replacements = [0];
  else {
    replacements = bindingValues(selector, allSuggestions);
    if (replacements.length === 0) {
      const keyPrefix = prefix ? `${prefix}.` : "";
      replacements = groupSuggestions
        .map((suggestion) =>
          suggestion.reference.path.startsWith(keyPrefix)
            ? suggestion.reference.path.slice(keyPrefix.length).split(/[.[]/, 1)[0]
            : "",
        )
        .filter(Boolean);
    }
  }
  return [...new Set(replacements)].flatMap((replacement) =>
    expandDynamicPathQueries(
      `${arraySelector ? `${prefix}[${replacement}]` : prefix ? `${prefix}.${replacement}` : String(replacement)}${suffix}`,
      groupSuggestions,
      allSuggestions,
    ),
  );
}

export function buildDataReferenceMenuOptions(
  query: string,
  suggestions: DataReferenceSuggestion[],
): DataReferenceMenuOption[] {
  const dataGroups = new Map<
    string,
    {
      dataName: string;
      bindingName: string;
      description: string;
      sourceKind?: "data" | "state" | "input" | "output" | "tool";
      suggestions: DataReferenceSuggestion[];
    }
  >();
  suggestions.forEach((suggestion) => {
    if (suggestion.menuHidden) return;
    const label = suggestionLabel(suggestion);
    const rootId =
      suggestion.reference.kind === "data"
        ? suggestion.reference.dataId
        : suggestion.reference.kind === "state"
          ? `runtime-state:${suggestion.reference.schemaKey ?? label.dataName}`
          : suggestion.reference.kind === "input"
            ? "function-inputs"
            : suggestion.reference.kind === "output"
              ? "function-output"
              : `tool-arguments:${suggestion.reference.toolId}`;
    const current = dataGroups.get(rootId);
    if (current) current.suggestions.push(suggestion);
    else
      dataGroups.set(rootId, {
        dataName: suggestion.dataName ?? label.dataName,
        bindingName: label.dataName,
        description: suggestion.dataDescription ?? "",
        sourceKind: suggestion.sourceKind,
        suggestions: [suggestion],
      });
  });

  const normalizedQuery = query.toLocaleLowerCase();
  const selectedData = [...dataGroups.entries()].find(([, group]) => {
    const bindingName = group.bindingName.toLocaleLowerCase();
    return normalizedQuery.startsWith(`${bindingName}.`) || normalizedQuery.startsWith(`${bindingName}[`);
  });
  if (!selectedData) {
    const search = normalizedQuery.trim();
    return [...dataGroups.entries()]
      .filter(
        ([, group]) =>
          !search ||
          group.dataName.toLocaleLowerCase().includes(search) ||
          group.bindingName.toLocaleLowerCase().includes(search),
      )
      .map(([dataId, group]) => ({
        kind: "data",
        dataId,
        dataName: group.dataName,
        ...(group.bindingName !== group.dataName ? { bindingName: group.bindingName } : {}),
        description: group.description,
        ...(group.sourceKind ? { sourceKind: group.sourceKind } : {}),
      }));
  }

  const [dataId, group] = selectedData;
  const rootSeparatorLength = query.charAt(group.bindingName.length) === "." ? 1 : 0;
  const pathQuery = query.slice(group.bindingName.length + rootSeparatorLength);
  const branches = new Map<string, Map<string, DataReferenceMenuOption>>();
  group.suggestions.forEach((suggestion) => {
    const tokens = tokenizeJsonPath(suggestion.reference.path);
    let prefix = "";
    tokens.forEach((token, index) => {
      const completed = token.kind === "index" ? `${prefix}${token.label}]` : `${prefix}${token.label}`;
      const isLeaf = index === tokens.length - 1;
      const nextToken = tokens[index + 1];
      const completedPath = isLeaf ? completed : `${completed}${nextToken.kind === "index" ? "[" : "."}`;
      const branch = branches.get(prefix) ?? new Map<string, DataReferenceMenuOption>();
      const optionKey = token.label || "__wildcard__";
      const existing = branch.get(optionKey);
      if (!existing || (!isLeaf && existing.kind === "path" && existing.isLeaf)) {
        branch.set(optionKey, {
          kind: "path",
          dataId,
          dataName: group.dataName,
          ...(group.bindingName !== group.dataName ? { bindingName: group.bindingName } : {}),
          segment: token.label || "All Items",
          fullPath: completedPath,
          isLeaf,
          ...(token.kind === "index" && !token.label ? { wildcard: true } : {}),
          suggestion: isLeaf ? suggestion : undefined,
          ...(group.sourceKind ? { sourceKind: group.sourceKind } : {}),
        });
      }
      branches.set(prefix, branch);
      prefix = completedPath;
    });
  });
  const expandedQueries = expandDynamicPathQueries(pathQuery, group.suggestions, suggestions);
  const options = new Map<string, DataReferenceMenuOption>();
  expandedQueries.forEach((expandedQuery) => {
    const activePrefix =
      [...branches.keys()]
        .filter((prefix) => expandedQuery.startsWith(prefix))
        .sort((left, right) => right.length - left.length)[0] ?? "";
    const search = expandedQuery.slice(activePrefix.length).toLocaleLowerCase();
    const actualBase = pathQuery.slice(0, Math.max(0, pathQuery.length - search.length));
    const branchOptions = [...(branches.get(activePrefix)?.values() ?? [])].filter(
      (option) => option.kind === "path" && (!search || option.segment.toLocaleLowerCase().includes(search)),
    );
    branchOptions.forEach((option) => {
      if (option.kind !== "path") return;
      const mapped = {
        ...option,
        fullPath: `${actualBase}${option.fullPath.slice(activePrefix.length)}`,
      };
      options.set(`${mapped.segment}:${mapped.fullPath}`, mapped);
    });
    if (
      group.sourceKind === "input" ||
      group.sourceKind === "output" ||
      group.sourceKind === "tool" ||
      search ||
      branchOptions.length === 0
    )
      return;
    const first = branchOptions.find((option) => option.kind === "path" && !option.wildcard);
    if (!first || first.kind !== "path") return;
    if (activePrefix.endsWith("[")) {
      const concrete = `${activePrefix}${first.segment}]`;
      const continuation = first.fullPath.slice(concrete.length) as "" | "." | "[";
      options.set("__dynamic_index__", {
        kind: "path",
        dataId,
        dataName: group.dataName,
        ...(group.bindingName !== group.dataName ? { bindingName: group.bindingName } : {}),
        segment: "Use Dynamic Index",
        fullPath: `${actualBase}@`,
        isLeaf: false,
        dynamicSelector: "index",
        dynamicContinuation: continuation,
      });
    } else if (activePrefix.endsWith(".") || (!activePrefix && group.sourceKind === "state")) {
      const concrete = `${activePrefix}${first.segment}`;
      const continuation = first.fullPath.slice(concrete.length) as "" | "." | "[";
      const uniformContainer =
        Boolean(continuation) &&
        branchOptions
          .filter(
            (option): option is Extract<DataReferenceMenuOption, { kind: "path" }> =>
              option.kind === "path" && !option.wildcard,
          )
          .every((option) => option.fullPath.slice(`${activePrefix}${option.segment}`.length) === continuation);
      if (!uniformContainer) return;
      options.set("__dynamic_key__", {
        kind: "path",
        dataId,
        dataName: group.dataName,
        ...(group.bindingName !== group.dataName ? { bindingName: group.bindingName } : {}),
        segment: "Use Dynamic Key",
        fullPath: `${actualBase.slice(0, -1)}[@`,
        isLeaf: false,
        dynamicSelector: "key",
        dynamicContinuation: continuation,
      });
    }
  });
  return [...options.values()]
    .sort((left, right) =>
      left.kind === "path" && left.dynamicSelector ? -1 : right.kind === "path" && right.dynamicSelector ? 1 : 0,
    )
    .slice(0, 20);
}

interface HoveredReference {
  values: Array<string | number | boolean>;
  hint?: string;
  left: number;
  top: number;
}

function formatReferenceValue(value: string | number | boolean) {
  return typeof value === "string" ? value : String(value);
}

function renderEditor(editor: HTMLDivElement, value: string, suggestions: DataReferenceSuggestion[]) {
  editor.replaceChildren();
  splitReferenceText(value, suggestions).forEach((part) => {
    if (part.kind === "text") {
      editor.append(document.createTextNode(part.value));
      return;
    }
    const badge = document.createElement("span");
    badge.dataset.bindingReference = "true";
    badge.dataset.expression = part.value;
    badge.contentEditable = "false";
    badge.className =
      part.suggestion.reference.kind === "state"
        ? "mx-0.5 inline-flex h-6 max-w-full select-all items-center rounded-md border border-[var(--blue-border)] bg-[var(--blue-soft)] px-2 align-middle font-mono text-[10px] font-semibold text-[var(--blue)]"
        : part.suggestion.reference.kind === "output" || part.suggestion.reference.kind === "tool"
          ? "mx-0.5 inline-flex h-6 max-w-full select-all items-center rounded-md border border-[var(--green-border)] bg-[var(--green-soft)] px-2 align-middle font-mono text-[10px] font-semibold text-[var(--green)]"
          : "mx-0.5 inline-flex h-6 max-w-full select-all items-center rounded-md border border-[var(--purple-border)] bg-[var(--purple-soft)] px-2 align-middle font-mono text-[10px] font-semibold text-[var(--purple)]";
    badge.textContent = part.value;
    editor.append(badge);
  });
}

function getCaretOffset(editor: HTMLDivElement) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) return editor.textContent?.length ?? 0;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(editor);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return range.toString().length;
}

function setCaretOffset(editor: HTMLDivElement, offset: number) {
  const selection = window.getSelection();
  if (!selection) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let current = 0;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (offset <= current + length) {
      const badge = (node.parentElement as HTMLElement | null)?.closest<HTMLElement>("[data-binding-reference]");
      if (badge) {
        if (offset <= current) range.setStartBefore(badge);
        else range.setStartAfter(badge);
      } else {
        range.setStart(node, Math.max(0, offset - current));
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    current += length;
    node = walker.nextNode();
  }
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertPlainText(text: string) {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

interface DataReferenceInputProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: DataReferenceSuggestion[];
  multiline?: boolean;
  className?: string;
  id?: string;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLDivElement>["inputMode"];
  autoFocus?: boolean;
  "aria-label"?: string;
}

export function DataReferenceInput({
  value,
  onChange,
  suggestions,
  multiline = false,
  className,
  id,
  placeholder,
  inputMode,
  autoFocus,
  "aria-label": ariaLabel,
}: DataReferenceInputProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState<ReferenceQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [hoveredReference, setHoveredReference] = useState<HoveredReference | null>(null);

  const filtered = useMemo<DataReferenceMenuOption[]>(() => {
    if (!query) return [];
    return buildDataReferenceMenuOptions(query.query, suggestions);
  }, [query, suggestions]);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setQuery(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  useEffect(() => setActiveIndex(0), [query?.query]);

  useLayoutEffect(() => {
    const listbox = listboxRef.current;
    const activeOption = listbox?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    if (!listbox || !activeOption) return;
    const optionTop = activeOption.offsetTop;
    const optionBottom = optionTop + activeOption.offsetHeight;
    if (optionTop < listbox.scrollTop) listbox.scrollTop = optionTop;
    else if (optionBottom > listbox.scrollTop + listbox.clientHeight) {
      listbox.scrollTop = optionBottom - listbox.clientHeight;
    }
  }, [activeIndex, filtered.length, query?.query]);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const expectedReferences = splitReferenceText(value, suggestions).filter(
      (part) => part.kind === "reference",
    ).length;
    const renderedReferences = editor.querySelectorAll("[data-binding-reference]").length;
    if (editor.textContent === value && expectedReferences === renderedReferences) return;
    const focused = document.activeElement === editor;
    const caret = focused ? getCaretOffset(editor) : 0;
    renderEditor(editor, value, suggestions);
    if (focused) setCaretOffset(editor, Math.min(caret, value.length));
  }, [suggestions, value]);

  useEffect(() => {
    if (!autoFocus) return;
    editorRef.current?.focus();
  }, [autoFocus]);

  const refreshQuery = (nextValue: string, caret: number | null) => {
    const nextQuery = caret === null ? null : findReferenceQuery(nextValue, caret);
    if (!nextQuery) {
      setQuery(null);
      return;
    }
    const normalized = nextQuery.query.toLocaleLowerCase();
    const completed = suggestions.some((suggestion) => {
      const expression = suggestion.expression.slice(1).toLocaleLowerCase();
      return (
        normalized === expression ||
        (normalized.startsWith(expression) && /[\s,;:!?)]/.test(nextQuery.query.charAt(expression.length)))
      );
    });
    setQuery(completed ? null : nextQuery);
  };
  const handleInput = (event: FormEvent<HTMLDivElement>) => {
    const editor = event.currentTarget;
    const nextValue = editor.textContent ?? "";
    const caret = getCaretOffset(editor);
    const expectedReferences = splitReferenceText(nextValue, suggestions).filter(
      (part) => part.kind === "reference",
    ).length;
    if (expectedReferences !== editor.querySelectorAll("[data-binding-reference]").length) {
      renderEditor(editor, nextValue, suggestions);
      setCaretOffset(editor, caret);
    }
    onChange(nextValue);
    refreshQuery(nextValue, caret);
  };
  const choose = (option: DataReferenceMenuOption) => {
    if (!query) return;
    const editor = editorRef.current;
    if (!editor) return;
    const bindingName = option.bindingName ?? option.dataName;
    if (option.kind === "path" && option.dynamicSelector) {
      const expression = `@${bindingName}${option.fullPath.startsWith("[") ? "" : "."}${option.fullPath}`;
      const inserted = insertReference(editor.textContent ?? value, query, expression);
      const innerStart = query.start + expression.lastIndexOf("@");
      renderEditor(editor, inserted.value, suggestions);
      onChange(inserted.value);
      setQuery({
        start: innerStart,
        end: inserted.caret,
        query: "",
        dynamicParents: [
          ...(query.dynamicParents ?? []),
          {
            start: query.start,
            continuation: option.dynamicContinuation ?? "",
          },
        ],
      });
      requestAnimationFrame(() => {
        editor.focus();
        setCaretOffset(editor, inserted.caret);
      });
      return;
    }
    const expression =
      option.kind === "data"
        ? `@${bindingName}.`
        : `@${bindingName}${option.fullPath.startsWith("[") ? "" : "."}${option.fullPath}`;
    const shouldCloseDynamicSelector = option.kind === "path" && option.isLeaf && Boolean(query.dynamicParents?.length);
    const dynamicParent = shouldCloseDynamicSelector ? query.dynamicParents![query.dynamicParents!.length - 1] : null;
    const inserted = insertReference(
      editor.textContent ?? value,
      query,
      shouldCloseDynamicSelector ? `${expression}]${dynamicParent?.continuation ?? ""}` : expression,
    );
    renderEditor(editor, inserted.value, suggestions);
    onChange(inserted.value);
    setQuery(
      shouldCloseDynamicSelector
        ? {
            start: dynamicParent!.start,
            end: inserted.caret,
            query: inserted.value.slice(dynamicParent!.start + 1, inserted.caret),
            ...(query.dynamicParents!.length > 1 ? { dynamicParents: query.dynamicParents!.slice(0, -1) } : {}),
          }
        : option.kind === "path" && option.isLeaf
          ? null
          : {
              start: query.start,
              end: inserted.caret,
              query: expression.slice(1),
              ...(query.dynamicParents?.length ? { dynamicParents: query.dynamicParents } : {}),
            },
    );
    requestAnimationFrame(() => {
      editor.focus();
      setCaretOffset(editor, inserted.caret);
    });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (query && filtered.length > 0 && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % filtered.length);
    } else if (query && filtered.length > 0 && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + filtered.length) % filtered.length);
    } else if (query && filtered.length > 0 && event.key === "Enter") {
      event.preventDefault();
      choose(filtered[activeIndex] ?? filtered[0]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery(null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (multiline) {
        insertPlainText("\n");
        editorRef.current?.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertLineBreak", data: "\n" }),
        );
      }
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        {!value && placeholder && (
          <span
            className={cn(
              "pointer-events-none absolute left-3 right-3 z-10 truncate text-sm text-[var(--text-muted)]",
              multiline ? "top-2.5" : "top-2",
            )}
          >
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          id={id}
          contentEditable
          suppressContentEditableWarning
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-expanded={Boolean(query)}
          aria-controls={query ? "data-reference-options" : undefined}
          aria-activedescendant={query && filtered[activeIndex] ? `data-reference-option-${activeIndex}` : undefined}
          inputMode={inputMode}
          onInput={handleInput}
          onClick={() =>
            refreshQuery(
              editorRef.current?.textContent ?? value,
              editorRef.current ? getCaretOffset(editorRef.current) : null,
            )
          }
          onKeyDown={handleKeyDown}
          onBlur={() => {
            setQuery(null);
            setHoveredReference(null);
          }}
          onMouseOver={(event) => {
            const badge = (event.target as HTMLElement).closest<HTMLElement>("[data-binding-reference]");
            const expression = badge?.dataset.expression;
            if (!badge || !expression) return;
            const suggestion = splitReferenceText(expression, suggestions).find(
              (part): part is Extract<ReferenceTextPart, { kind: "reference" }> =>
                part.kind === "reference" && part.value === expression,
            )?.suggestion;
            if (!suggestion) return;
            const rect = badge.getBoundingClientRect();
            setHoveredReference({
              values: suggestion.values,
              hint: suggestion.hint,
              left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
              top: rect.bottom + 6,
            });
          }}
          onMouseOut={(event) => {
            const badge = (event.target as HTMLElement).closest<HTMLElement>("[data-binding-reference]");
            if (!badge || (event.relatedTarget instanceof Node && badge.contains(event.relatedTarget))) return;
            setHoveredReference(null);
          }}
          onPaste={(event) => {
            event.preventDefault();
            insertPlainText(event.clipboardData.getData("text/plain"));
            event.currentTarget.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
          }}
          className={cn(
            "w-full cursor-text whitespace-pre-wrap break-words rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm leading-6 text-[var(--text)] outline-none transition-shadow focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]",
            multiline ? "min-h-28 py-2.5" : "min-h-10 overflow-x-auto whitespace-nowrap py-2",
            className,
          )}
        />
      </div>
      {query && (
        <div
          ref={listboxRef}
          id="data-reference-options"
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-xl"
        >
          {filtered.length > 0 ? (
            filtered.map((option, index) => {
              return (
                <button
                  key={option.kind === "data" ? option.dataId : `${option.dataId}:${option.fullPath}`}
                  id={`data-reference-option-${index}`}
                  data-option-index={index}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                    index === activeIndex ? "bg-[var(--blue-soft)]" : "hover:bg-[var(--surface-hover)]",
                  )}
                >
                  {option.kind === "data" && (
                    <span
                      className={cn(
                        "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        option.sourceKind === "state"
                          ? "bg-[var(--blue-soft)] text-[var(--blue)]"
                          : option.sourceKind === "output" || option.sourceKind === "tool"
                            ? "bg-[var(--green-soft)] text-[var(--green)]"
                            : "bg-[var(--purple-soft)] text-[var(--purple)]",
                      )}
                    >
                      {option.sourceKind === "state" ? (
                        <MemoryStick className="h-3.5 w-3.5" />
                      ) : option.sourceKind === "tool" ? (
                        <Wrench className="h-3.5 w-3.5" />
                      ) : option.sourceKind === "output" || option.sourceKind === "input" ? (
                        <Braces className="h-3.5 w-3.5" />
                      ) : (
                        <Database className="h-3.5 w-3.5" />
                      )}
                    </span>
                  )}
                  {option.kind === "path" && option.dynamicSelector && (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--blue-soft)] text-[var(--blue)]">
                      <MemoryStick className="h-3.5 w-3.5" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1">
                    {option.kind === "data" ? (
                      <>
                        <span className="block truncate text-[10px] font-bold text-[var(--text)]">
                          {option.dataName}
                        </span>
                        <span className="block truncate text-[9px] text-[var(--text-muted)]">
                          {option.description || "No description"}
                        </span>
                      </>
                    ) : (
                      <span className="block truncate font-mono text-[10px] font-semibold text-[var(--text)]">
                        {option.segment}
                      </span>
                    )}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-3 py-4 text-center text-[10px] text-[var(--text-muted)]">No matching JSON Data path</div>
          )}
        </div>
      )}
      {hoveredReference &&
        createPortal(
          <div
            role="tooltip"
            style={{ left: hoveredReference.left, top: hoveredReference.top }}
            className="pointer-events-none fixed z-[100] max-h-48 w-max max-w-[min(320px,calc(100vw-16px))] overflow-hidden rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 shadow-lg"
          >
            <div className="space-y-1">
              {hoveredReference.values.slice(0, 8).map((item, index) => (
                <div
                  key={index}
                  className="max-w-[290px] truncate font-mono text-[10px] leading-4 text-[var(--text-secondary)]"
                >
                  {formatReferenceValue(item)}
                </div>
              ))}
              {hoveredReference.values.length === 0 && hoveredReference.hint && (
                <div className="max-w-[290px] truncate text-[10px] leading-4 text-[var(--text-secondary)]">
                  {hoveredReference.hint}
                </div>
              )}
              {hoveredReference.values.length > 8 && (
                <div className="text-[10px] leading-4 text-[var(--text-muted)]">…</div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
