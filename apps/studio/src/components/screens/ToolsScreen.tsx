import {
  ArrowLeft,
  Braces,
  Copy,
  Database,
  LockKeyhole,
  MemoryStick,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import type {
  ToolDefinition,
  ToolEnumValue,
  ToolInput,
  ToolInputType,
  ToolParameter,
  ToolParameterItemType,
  ToolParameterType,
} from "../../domain/flow";
import {
  formatDataReference,
  isDataReference,
  isIndirectDataReference,
  isInputReference,
  listDataReferenceSuggestions,
  parseDataReferenceExpression,
  resolveDataReference,
} from "../../domain/dataReferences";
import type { DataAsset } from "../../domain/workspaces";
import type { StateSchema } from "../../domain/state";
import {
  formatStateReference,
  isStateReference,
  listStateReferenceSuggestions,
  parseStateReferenceExpression,
  stateReferenceExists,
} from "../../domain/stateReferences";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataReferenceInput } from "../ui/DataReferenceInput";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Select } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DISPLAY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 -]*$/;
const DISPLAY_NAME_ERROR = "Use English letters, numbers, spaces, and hyphens only. Start with a letter.";

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function toFunctionName(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+/g, "");
}

function createParameter(): ToolParameter {
  return { id: `parameter-${crypto.randomUUID()}`, name: "", description: "", type: "string", required: true };
}

function createToolInput(): ToolInput {
  return {
    id: `input-${crypto.randomUUID()}`,
    displayName: "",
    name: "",
    description: "",
    type: "string",
    required: true,
  };
}

function enumType(parameter: ToolParameter): ToolParameterItemType | null {
  const type = parameter.type === "array" ? parameter.itemType : parameter.type;
  return type && type !== "boolean" ? type : null;
}

function statePreview(stateSchemas: StateSchema[]) {
  return Object.fromEntries(
    stateSchemas.flatMap((schema) =>
      schema.groups.map((group) => [
        group.key,
        Object.fromEntries(group.fields.map((field) => [field.key, field.defaultValue])),
      ]),
    ),
  );
}

function validEnumValues(
  parameter: ToolParameter,
  assets: DataAsset[],
  stateSchemas: StateSchema[],
  inputs: ToolInput[] = [],
) {
  const type = enumType(parameter);
  const entries = parameter.enumValues ?? [];
  if (!type || entries.length === 0) return true;
  if (entries.some((entry) => typeof entry === "string" && entry.trim().startsWith("@"))) return false;
  const preview = statePreview(stateSchemas);
  const values = entries.flatMap((entry) =>
    isDataReference(entry)
      ? (resolveDataReference(entry, assets, preview) ?? [])
      : isStateReference(entry) || isInputReference(entry)
        ? []
        : [entry],
  );
  if (
    entries.some((entry) => isDataReference(entry) && !resolveDataReference(entry, assets, preview)) ||
    entries.some((entry) => isStateReference(entry) && !stateReferenceExists(entry, stateSchemas)) ||
    entries.some((entry) => isInputReference(entry) && !inputs.some((input) => input.name === entry.inputKey))
  )
    return false;
  if (entries.every((entry) => isStateReference(entry) || isInputReference(entry))) return true;
  if (values.length === 0) return false;
  const normalized = values.map((value) => String(value).trim());
  if (normalized.some((value) => !value) || new Set(normalized).size !== normalized.length) return false;
  if (type === "string") return values.every((value) => typeof value === "string");
  return values.every(
    (value) => typeof value === "number" && Number.isFinite(value) && (type !== "integer" || Number.isInteger(value)),
  );
}

function isValidTool(
  tool: Pick<ToolDefinition, "displayName" | "name" | "description" | "inputs" | "parameters">,
  assets: DataAsset[],
  stateSchemas: StateSchema[],
) {
  const inputs = tool.inputs ?? [];
  const inputNames = inputs.map((input) => input.name);
  const names = tool.parameters.map((parameter) => parameter.name);
  return Boolean(
    DISPLAY_NAME_PATTERN.test(tool.displayName.trim()) &&
    NAME_PATTERN.test(tool.name) &&
    tool.description.trim() &&
    inputNames.every((name) => NAME_PATTERN.test(name)) &&
    new Set(inputNames).size === inputNames.length &&
    inputs.every((input) => DISPLAY_NAME_PATTERN.test(input.displayName?.trim() ?? "")) &&
    names.every((name) => NAME_PATTERN.test(name)) &&
    new Set(names).size === names.length &&
    tool.parameters.every((parameter) => {
      if (!parameter.description.trim()) return false;
      if (parameter.type === "array" && !parameter.itemType) return false;
      return validEnumValues(parameter, assets, stateSchemas, inputs);
    }),
  );
}

export function ToolsScreen({
  tools,
  dataAssets,
  stateSchemas,
  onSave,
  onDelete,
}: {
  tools: ToolDefinition[];
  dataAssets: DataAsset[];
  stateSchemas: StateSchema[];
  onSave: (tool: Omit<ToolDefinition, "updatedAt">) => void;
  onDelete: (toolId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [functionName, setFunctionName] = useState("");
  const [description, setDescription] = useState("");
  const [inputs, setInputs] = useState<ToolInput[]>([]);
  const [parameters, setParameters] = useState<ToolParameter[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailTab, setDetailTab] = useState<"inputs" | "parameters">("inputs");
  const [inputDraft, setInputDraft] = useState<ToolInput | null>(null);
  const [editingInputId, setEditingInputId] = useState<string | null>(null);
  const [editingParameterId, setEditingParameterId] = useState<string | null>(null);
  const [parameterBackup, setParameterBackup] = useState<ToolParameter[] | null>(null);
  const [enumValueEditor, setEnumValueEditor] = useState<{
    parameterId: string;
    optionIndex: number;
    previousValues: ToolEnumValue[];
  } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? tools.filter((tool) =>
          `${tool.displayName} ${tool.name} ${tool.description}`.toLocaleLowerCase().includes(normalized),
        )
      : tools;
  }, [query, tools]);
  const dataSuggestions = useMemo(() => listDataReferenceSuggestions(dataAssets), [dataAssets]);
  const runtimeSuggestions = useMemo(
    () => [...dataSuggestions, ...listStateReferenceSuggestions(stateSchemas)],
    [dataSuggestions, stateSchemas],
  );
  const inputSuggestions = useMemo(
    () =>
      inputs.map((input) => ({
        expression: `@inputs.${input.name}`,
        reference: { kind: "input" as const, inputKey: input.name, path: input.name },
        values: [],
        dataName: "Inputs",
        dataDescription: "Values provided by the Agent Node before this Tool is exposed.",
        sourceKind: "input" as const,
        valueType: input.type,
        hint: input.description || undefined,
      })),
    [inputs],
  );
  const bindingSuggestions = useMemo(
    () => [...inputSuggestions, ...runtimeSuggestions],
    [inputSuggestions, runtimeSuggestions],
  );

  const currentDraft: ToolDefinition = {
    id: editingId ?? "tool-preview",
    displayName: displayName.trim(),
    name: functionName.trim(),
    description: description.trim(),
    inputs,
    parameters,
    updatedAt: new Date().toISOString(),
  };
  const parameterNames = parameters.map((parameter) => parameter.name).filter(Boolean);
  const hasDuplicateParameters = new Set(parameterNames).size !== parameterNames.length;
  const duplicateName = tools.some(
    (tool) =>
      tool.id !== editingId && tool.displayName.trim().toLocaleLowerCase() === displayName.trim().toLocaleLowerCase(),
  );
  const duplicateKey = tools.some((tool) => tool.id !== editingId && tool.name === functionName);
  const nameError =
    displayName && !DISPLAY_NAME_PATTERN.test(displayName.trim())
      ? DISPLAY_NAME_ERROR
      : duplicateName || duplicateKey
        ? "Name must be unique in this Workspace."
        : undefined;
  const canSave = Boolean(isValidTool(currentDraft, dataAssets, stateSchemas) && !duplicateName && !duplicateKey);
  const pendingDelete = tools.find((tool) => tool.id === pendingDeleteId) ?? null;

  const openCreate = () => {
    setEditingId(null);
    setDisplayName("");
    setFunctionName("");
    setDescription("");
    setInputs([]);
    setParameters([]);
    setEditorOpen(true);
  };
  const loadTool = (tool: ToolDefinition) => {
    setEditingId(tool.id);
    setDisplayName(tool.displayName);
    setFunctionName(tool.name);
    setDescription(tool.description);
    setInputs(structuredClone(tool.inputs ?? []));
    setParameters(structuredClone(tool.parameters));
  };
  const openEdit = (tool: ToolDefinition) => {
    loadTool(tool);
    setEditorOpen(true);
  };
  const openDetail = (tool: ToolDefinition) => {
    loadTool(tool);
    setDetailTab("inputs");
    setDetailOpen(true);
  };
  const changeDisplayName = (value: string) => {
    setDisplayName(value);
    setFunctionName(toFunctionName(value));
  };
  const duplicateTool = (tool: ToolDefinition) => {
    const usedNames = new Set(tools.map((item) => item.displayName.trim().toLocaleLowerCase()));
    const usedKeys = new Set(tools.map((item) => item.name));
    let nextName = `${tool.displayName} Copy`;
    let nextKey = `${tool.name}_copy`;
    let suffix = 2;
    while (usedNames.has(nextName.toLocaleLowerCase()) || usedKeys.has(nextKey)) {
      nextName = `${tool.displayName} Copy ${suffix}`;
      nextKey = `${tool.name}_copy_${suffix}`;
      suffix += 1;
    }
    onSave({
      id: `tool-${crypto.randomUUID()}`,
      displayName: nextName,
      name: nextKey,
      description: tool.description,
      inputs: structuredClone(tool.inputs ?? []),
      parameters: structuredClone(tool.parameters),
    });
  };
  const updateParameter = (id: string, patch: Partial<ToolParameter>) =>
    setParameters((current) =>
      current.map((parameter) => (parameter.id === id ? { ...parameter, ...patch } : parameter)),
    );
  const changeParameterType = (id: string, type: ToolParameterType) =>
    setParameters((current) =>
      current.map((parameter) => {
        if (parameter.id !== id) return parameter;
        if (type === "array")
          return {
            ...parameter,
            type,
            itemType: parameter.itemType ?? "string",
            uniqueItems: parameter.uniqueItems ?? true,
          };
        return {
          ...parameter,
          type,
          itemType: undefined,
          uniqueItems: undefined,
          enumValues: type === "boolean" ? undefined : parameter.enumValues,
        };
      }),
    );
  const changeArrayItemType = (id: string, itemType: ToolParameterItemType) =>
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === id
          ? { ...parameter, itemType, enumValues: itemType === "boolean" ? undefined : parameter.enumValues }
          : parameter,
      ),
    );
  const updateEnumValue = (parameterId: string, optionIndex: number, value: ToolEnumValue) =>
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === parameterId
          ? {
              ...parameter,
              enumValues: (parameter.enumValues ?? []).map((option, index) => (index === optionIndex ? value : option)),
            }
          : parameter,
      ),
    );
  const removeEnumValue = (parameterId: string, optionIndex: number) =>
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === parameterId
          ? { ...parameter, enumValues: (parameter.enumValues ?? []).filter((_, index) => index !== optionIndex) }
          : parameter,
      ),
    );
  const openEnumValueEditor = (parameterId: string, optionIndex: number) => {
    const parameter = parameters.find((candidate) => candidate.id === parameterId);
    if (!parameter) return;
    setEnumValueEditor({
      parameterId,
      optionIndex,
      previousValues: structuredClone(parameter.enumValues ?? []),
    });
  };
  const addEnumValue = (parameterId: string) =>
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === parameterId ? { ...parameter, enumValues: [...(parameter.enumValues ?? []), ""] } : parameter,
      ),
    );
  const cancelEnumValueEditor = () => {
    if (!enumValueEditor) return;
    setParameters((current) =>
      current.map((parameter) =>
        parameter.id === enumValueEditor.parameterId
          ? { ...parameter, enumValues: enumValueEditor.previousValues }
          : parameter,
      ),
    );
    setEnumValueEditor(null);
  };
  const openParameterEditor = (parameterId: string) => {
    setParameterBackup(structuredClone(parameters));
    setEditingParameterId(parameterId);
  };
  const openNewParameter = () => {
    const parameter = createParameter();
    setParameterBackup(structuredClone(parameters));
    setParameters((current) => [...current, parameter]);
    setEditingParameterId(parameter.id);
  };
  const cancelParameterEditor = () => {
    if (parameterBackup) setParameters(parameterBackup);
    setParameterBackup(null);
    setEditingParameterId(null);
  };
  const saveParameterEditor = () => {
    setParameterBackup(null);
    setEditingParameterId(null);
  };
  const parameterCanSave = (parameter: ToolParameter) =>
    Boolean(
      NAME_PATTERN.test(parameter.name) &&
      parameter.description.trim() &&
      (parameter.type !== "array" || parameter.itemType) &&
      validEnumValues(parameter, dataAssets, stateSchemas, inputs) &&
      !parameters.some((candidate) => candidate.id !== parameter.id && candidate.name === parameter.name),
    );
  const normalizedTool = () => {
    const normalizedParameters = parameters.map((parameter) => {
      const type = enumType(parameter);
      return {
        ...parameter,
        enumValues: parameter.enumValues?.map((value) =>
          isDataReference(value) || isStateReference(value) || isInputReference(value)
            ? value
            : type === "number" || type === "integer"
              ? Number(value)
              : String(value).trim(),
        ),
      };
    });
    return {
      id: editingId ?? `tool-${crypto.randomUUID()}`,
      displayName: displayName.trim(),
      name: functionName.trim(),
      description: description.trim(),
      inputs: structuredClone(inputs),
      parameters: normalizedParameters,
    };
  };
  const save = () => {
    if (!canSave) return;
    const tool = normalizedTool();
    onSave(tool);
    setEditorOpen(false);
    if (!editingId) {
      setEditingId(tool.id);
      setDetailOpen(true);
    }
  };
  const saveDetail = () => {
    if (!canSave) return;
    onSave(normalizedTool());
    setDetailOpen(false);
  };
  const enumEditorParameter = enumValueEditor
    ? (parameters.find((parameter) => parameter.id === enumValueEditor.parameterId) ?? null)
    : null;
  const enumEditorValue =
    enumEditorParameter && enumValueEditor ? enumEditorParameter.enumValues?.[enumValueEditor.optionIndex] : undefined;
  const enumEditorInputValue = isDataReference(enumEditorValue)
    ? formatDataReference(enumEditorValue, dataAssets)
    : isStateReference(enumEditorValue)
      ? formatStateReference(enumEditorValue, stateSchemas)
      : isInputReference(enumEditorValue)
        ? `@inputs.${enumEditorValue.path}`
        : enumEditorValue === undefined
          ? ""
          : String(enumEditorValue);
  const enumEditorCanSave = Boolean(
    enumEditorParameter && validEnumValues(enumEditorParameter, dataAssets, stateSchemas, inputs),
  );
  const changeEnumEditorValue = (value: string) => {
    if (!enumValueEditor || !enumEditorParameter) return;
    const reference =
      parseDataReferenceExpression(value, dataAssets) ??
      parseStateReferenceExpression(value, stateSchemas) ??
      inputSuggestions.find((suggestion) => suggestion.expression === value)?.reference;
    const valueType = enumType(enumEditorParameter);
    const numericValue = Number(value);
    const nextValue =
      reference && (reference.kind === "data" || reference.kind === "state" || reference.kind === "input")
        ? reference
        : (valueType === "number" || valueType === "integer") && value.trim() && Number.isFinite(numericValue)
          ? numericValue
          : value;
    updateEnumValue(enumValueEditor.parameterId, enumValueEditor.optionIndex, nextValue);
  };

  const inputDraftDuplicate = Boolean(
    inputDraft && inputs.some((input) => input.id !== editingInputId && input.name === inputDraft.name),
  );
  const inputDraftValid = Boolean(
    inputDraft &&
    DISPLAY_NAME_PATTERN.test(inputDraft.displayName?.trim() ?? "") &&
    NAME_PATTERN.test(inputDraft.name) &&
    !inputDraftDuplicate,
  );
  const openInputEditor = (input?: ToolInput) => {
    setEditingInputId(input?.id ?? null);
    setInputDraft(input ? structuredClone(input) : createToolInput());
  };
  const saveInputEditor = () => {
    if (!inputDraft || !inputDraftValid) return;
    setInputs((current) =>
      editingInputId
        ? current.map((input) => (input.id === editingInputId ? inputDraft : input))
        : [...current, inputDraft],
    );
    setInputDraft(null);
    setEditingInputId(null);
  };

  const inputsPanel = (
    <>
      <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
        <div className="flex items-start gap-4 border-b border-[var(--green-border)] bg-[var(--green-soft)] px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--green-border)] bg-[var(--surface)] text-[var(--green)]">
            <Braces className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="truncate text-xs font-extrabold text-[var(--text)]">Inputs</h4>
              <Badge className="border-[var(--green-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs">
                {inputs.length} fields
              </Badge>
            </div>
            <p className="mt-1 font-mono text-[9px] text-[var(--green)]">@inputs</p>
          </div>
          <Tooltip content="The Tool input namespace cannot be renamed or deleted">
            <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--green-border)] bg-[var(--surface)] px-2.5 text-[9px] font-bold text-[var(--text-muted)]">
              <LockKeyhole className="h-3 w-3" /> Locked
            </span>
          </Tooltip>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {inputs.map((input) => (
            <div
              key={input.id}
              className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_110px_38px] items-center gap-3 px-5 transition-colors hover:bg-[var(--surface-hover)] max-md:grid-cols-[minmax(0,1fr)_auto_38px]"
            >
              <button
                type="button"
                onClick={() => openInputEditor(input)}
                className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1.6fr)_120px] items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] max-md:col-span-1 max-md:grid-cols-1"
                aria-label={`Edit ${input.displayName || input.name}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-[var(--text)]">
                    {input.displayName || input.name}
                  </span>
                  <span className="mt-1 block truncate font-mono text-[9px] text-[var(--green)]">
                    @inputs.{input.name}
                  </span>
                </span>
                <Badge className="max-md:hidden">{input.type}</Badge>
              </button>
              <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]">
                <input
                  type="checkbox"
                  checked={input.required}
                  onChange={(event) =>
                    setInputs((current) =>
                      current.map((candidate) =>
                        candidate.id === input.id ? { ...candidate, required: event.target.checked } : candidate,
                      ),
                    )
                  }
                  className="h-4 w-4 accent-[var(--green)]"
                />
                <span>Required</span>
              </label>
              <Tooltip content="Delete Input">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                  onClick={() => setInputs((current) => current.filter((candidate) => candidate.id !== input.id))}
                  aria-label={`Delete ${input.displayName || input.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </Tooltip>
            </div>
          ))}
          {inputs.length === 0 && (
            <div className="px-5 py-7 text-center text-[10px] text-[var(--text-muted)]">
              No runtime inputs for this Tool.
            </div>
          )}
        </div>
        <div className="border-t border-[var(--border)] px-4 py-2.5">
          <Button variant="ghost" size="sm" onClick={() => openInputEditor()}>
            <Plus className="h-3.5 w-3.5" /> Add Field
          </Button>
        </div>
      </article>
      <Dialog
        open={Boolean(inputDraft)}
        onOpenChange={(open) => {
          if (!open) {
            setInputDraft(null);
            setEditingInputId(null);
          }
        }}
        title={editingInputId ? "Edit Input Field" : "Add Input Field"}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setInputDraft(null);
                setEditingInputId(null);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" disabled={!inputDraftValid} onClick={saveInputEditor}>
              {editingInputId ? "Save" : "Add Field"}
            </Button>
          </>
        }
      >
        {inputDraft && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field
                label="Name"
                htmlFor="tool-input-name"
                error={
                  inputDraftDuplicate
                    ? "Name must be unique in this Tool."
                    : inputDraft.displayName && !DISPLAY_NAME_PATTERN.test(inputDraft.displayName)
                      ? DISPLAY_NAME_ERROR
                      : undefined
                }
              >
                <Input
                  id="tool-input-name"
                  value={inputDraft.displayName ?? ""}
                  onChange={(event) =>
                    setInputDraft({
                      ...inputDraft,
                      displayName: event.target.value,
                      name: toFunctionName(event.target.value),
                    })
                  }
                  placeholder="e.g. Response Options"
                  autoFocus
                />
              </Field>
              <Field label="Key" htmlFor="tool-input-key">
                <Input
                  id="tool-input-key"
                  value={inputDraft.name}
                  readOnly
                  aria-readonly="true"
                  className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
                />
              </Field>
            </div>
            <Field label="Type" htmlFor="tool-input-type">
              <Select
                id="tool-input-type"
                value={inputDraft.type}
                onChange={(event) => setInputDraft({ ...inputDraft, type: event.target.value as ToolInputType })}
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="integer">Integer</option>
                <option value="boolean">Boolean</option>
                <option value="array">Array</option>
                <option value="object">Object</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="tool-input-description">
              <Input
                id="tool-input-description"
                value={inputDraft.description}
                onChange={(event) => setInputDraft({ ...inputDraft, description: event.target.value })}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]">
              <input
                type="checkbox"
                checked={inputDraft.required}
                onChange={(event) => setInputDraft({ ...inputDraft, required: event.target.checked })}
                className="h-4 w-4 accent-[var(--green)]"
              />
              <span>Required</span>
            </label>
          </div>
        )}
      </Dialog>
    </>
  );

  const parametersPanel = (
    <>
      {parameters.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
          <Wrench className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
          <h4 className="mt-3 text-xs font-bold text-[var(--text)]">Add your first Parameter</h4>
          <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
            Define the structured values GPT Realtime can send with this Tool.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {parameters.map((parameter, index) => {
            const duplicate =
              parameter.name &&
              parameters.some((candidate) => candidate.id !== parameter.id && candidate.name === parameter.name);
            return (
              <article
                key={parameter.id}
                className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs"
              >
                <div className="flex items-start gap-4 border-b border-[var(--green-border)] bg-[var(--green-soft)] px-5 py-4">
                  <button
                    type="button"
                    onClick={() => openParameterEditor(parameter.id)}
                    className="flex min-w-0 flex-1 items-start gap-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    aria-label={`Edit ${parameter.name || `parameter ${index + 1}`}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--green-border)] bg-[var(--surface)] text-[var(--green)]">
                      <Wrench className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-xs font-extrabold text-[var(--text)]">
                          {parameter.name || "Untitled Parameter"}
                        </span>
                        <Badge className="border-[var(--green-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs">
                          {parameter.type.charAt(0).toUpperCase() + parameter.type.slice(1)}
                        </Badge>
                        <Badge
                          tone={parameter.required ? "green" : "neutral"}
                          className="bg-[var(--surface)] shadow-xs"
                        >
                          {parameter.required ? "Required" : "Optional"}
                        </Badge>
                      </span>
                      <span className="mt-1.5 block line-clamp-2 text-[10px] leading-4 text-[var(--text-muted)]">
                        {parameter.description || "No description"}
                      </span>
                    </span>
                  </button>
                  <Tooltip content="Edit Parameter">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openParameterEditor(parameter.id)}
                      aria-label={`Edit ${parameter.name || `parameter ${index + 1}`}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Delete Parameter">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                      onClick={() => setParameters((current) => current.filter((item) => item.id !== parameter.id))}
                      aria-label={`Delete parameter ${index + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </Tooltip>
                </div>
                <Dialog
                  open={editingParameterId === parameter.id}
                  onOpenChange={(open) => {
                    if (!open) cancelParameterEditor();
                  }}
                  title={
                    parameterBackup?.some((candidate) => candidate.id === parameter.id)
                      ? "Edit Parameter"
                      : "Add Parameter"
                  }
                  footer={
                    <>
                      <Button variant="secondary" onClick={cancelParameterEditor}>
                        Cancel
                      </Button>
                      <Button variant="primary" disabled={!parameterCanSave(parameter)} onClick={saveParameterEditor}>
                        {parameterBackup?.some((candidate) => candidate.id === parameter.id) ? "Save" : "Add Parameter"}
                      </Button>
                    </>
                  }
                >
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
                      <Field
                        label="Name"
                        htmlFor={`parameter-name-${parameter.id}`}
                        error={duplicate ? "Parameter names must be unique." : undefined}
                      >
                        <Input
                          id={`parameter-name-${parameter.id}`}
                          value={parameter.name}
                          onChange={(event) =>
                            updateParameter(parameter.id, {
                              name: toFunctionName(event.target.value),
                            })
                          }
                          placeholder="decision"
                          className="font-mono"
                        />
                      </Field>
                      <Field label="Type" htmlFor={`parameter-type-${parameter.id}`}>
                        <Select
                          id={`parameter-type-${parameter.id}`}
                          value={parameter.type}
                          onChange={(event) =>
                            changeParameterType(parameter.id, event.target.value as ToolParameterType)
                          }
                        >
                          <option value="string">String</option>
                          <option value="number">Number</option>
                          <option value="integer">Integer</option>
                          <option value="boolean">Boolean</option>
                          <option value="array">Array</option>
                        </Select>
                      </Field>
                    </div>
                    {parameter.type === "array" && (
                      <div className="grid grid-cols-[1fr_auto] items-end gap-4 max-sm:grid-cols-1">
                        <Field label="Item Type" htmlFor={`parameter-item-type-${parameter.id}`}>
                          <Select
                            id={`parameter-item-type-${parameter.id}`}
                            value={parameter.itemType ?? "string"}
                            onChange={(event) =>
                              changeArrayItemType(parameter.id, event.target.value as ToolParameterItemType)
                            }
                          >
                            <option value="string">String</option>
                            <option value="number">Number</option>
                            <option value="integer">Integer</option>
                            <option value="boolean">Boolean</option>
                          </Select>
                        </Field>
                        <label className="flex h-10 cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] px-3.5">
                          <span className="text-[11px] font-bold text-[var(--text)]">Unique Items</span>
                          <input
                            type="checkbox"
                            checked={parameter.uniqueItems ?? false}
                            onChange={(event) =>
                              updateParameter(parameter.id, {
                                uniqueItems: event.target.checked,
                              })
                            }
                            className="h-4 w-4 accent-[var(--green)]"
                          />
                        </label>
                      </div>
                    )}
                    <Field label="Description" htmlFor={`parameter-description-${parameter.id}`}>
                      <DataReferenceInput
                        id={`parameter-description-${parameter.id}`}
                        value={parameter.description}
                        onChange={(value) => updateParameter(parameter.id, { description: value })}
                        suggestions={bindingSuggestions}
                        placeholder="Describe the value. Type @ to bind Data or State."
                        multiline
                        className="min-h-20"
                      />
                    </Field>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3.5">
                      <span className="min-w-0 flex-1 text-[11px] font-bold text-[var(--text)]">Required</span>
                      <input
                        type="checkbox"
                        checked={parameter.required}
                        onChange={(event) =>
                          updateParameter(parameter.id, {
                            required: event.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-[var(--green)]"
                      />
                    </label>
                  </div>
                </Dialog>
                {enumType(parameter) && (
                  <div className="border-t border-[var(--border)]">
                    <div className="divide-y divide-[var(--border)]">
                      {(parameter.enumValues ?? []).length === 0 && (
                        <p className="px-5 py-4 text-[10px] text-[var(--text-muted)]">No enum values.</p>
                      )}
                      {(parameter.enumValues ?? []).map((option, optionIndex) => {
                        const reference =
                          isDataReference(option) || isStateReference(option) || isInputReference(option)
                            ? option
                            : null;
                        const resolvedValues =
                          reference?.kind === "data"
                            ? resolveDataReference(reference, dataAssets, statePreview(stateSchemas))
                            : null;
                        const inputValue =
                          reference?.kind === "data"
                            ? formatDataReference(reference, dataAssets)
                            : reference?.kind === "state"
                              ? formatStateReference(reference, stateSchemas)
                              : reference?.kind === "input"
                                ? `@inputs.${reference.path}`
                                : String(option);
                        return (
                          <div
                            key={`${parameter.id}-option-${optionIndex}`}
                            className="flex min-h-12 items-center gap-2 px-5 transition-colors hover:bg-[var(--surface-hover)]"
                          >
                            <button
                              type="button"
                              onClick={() => openEnumValueEditor(parameter.id, optionIndex)}
                              className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                              aria-label={`Edit enum value ${optionIndex + 1}`}
                            >
                              <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-[var(--text-secondary)]">
                                {inputValue || "Untitled Value"}
                              </span>
                              {reference?.kind === "data" && (
                                <Badge tone={resolvedValues ? "blue" : "amber"}>
                                  <Database className="h-3 w-3" />
                                  {resolvedValues
                                    ? isIndirectDataReference(reference)
                                      ? `Runtime · ${resolvedValues.length}`
                                      : `${resolvedValues.length} values`
                                    : "Broken"}
                                </Badge>
                              )}
                              {reference?.kind === "state" && (
                                <Badge tone={stateReferenceExists(reference, stateSchemas) ? "blue" : "amber"}>
                                  <MemoryStick className="h-3 w-3" />
                                  {stateReferenceExists(reference, stateSchemas) ? "Runtime" : "Broken"}
                                </Badge>
                              )}
                              {reference?.kind === "input" && (
                                <Badge
                                  tone={inputs.some((input) => input.name === reference.inputKey) ? "blue" : "amber"}
                                >
                                  <Braces className="h-3 w-3" />
                                  {inputs.some((input) => input.name === reference.inputKey) ? "Runtime" : "Broken"}
                                </Badge>
                              )}
                            </button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 shrink-0 text-[var(--red)] hover:text-[var(--red)]"
                              onClick={() => removeEnumValue(parameter.id, optionIndex)}
                              aria-label={`Delete enum value ${optionIndex + 1}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="border-t border-[var(--border)] px-4 py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => addEnumValue(parameter.id)}>
                        <Plus className="h-3.5 w-3.5" /> Add Value
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      {hasDuplicateParameters && (
        <p className="mt-2 text-[10px] font-semibold text-[var(--red)]">Each parameter must have a unique name.</p>
      )}
      <Dialog
        open={Boolean(enumValueEditor && enumEditorParameter)}
        onOpenChange={(open) => {
          if (!open) cancelEnumValueEditor();
        }}
        title="Edit Value"
        footer={
          <>
            <Button variant="secondary" onClick={cancelEnumValueEditor}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!enumEditorCanSave} onClick={() => setEnumValueEditor(null)}>
              Save
            </Button>
          </>
        }
      >
        {enumEditorParameter && enumValueEditor && (
          <Field label="Value" htmlFor="tool-enum-value">
            <DataReferenceInput
              id="tool-enum-value"
              inputMode={enumType(enumEditorParameter) === "string" ? "text" : "decimal"}
              value={enumEditorInputValue}
              onChange={changeEnumEditorValue}
              suggestions={bindingSuggestions}
              placeholder="Value, @Data.path, or @state.path"
              className="font-mono"
              autoFocus
            />
          </Field>
        )}
      </Dialog>
    </>
  );

  if (detailOpen) {
    return (
      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)]">
        <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5">
          <Tooltip content="Back to Tools">
            <Button variant="ghost" size="icon" onClick={() => setDetailOpen(false)} aria-label="Back to Tools">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Tooltip>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-extrabold text-[var(--text)]">{displayName || "Untitled Tool"}</p>
            <p className="font-mono text-[9px] text-[var(--green)]">{functionName}</p>
          </div>
          <Button variant="primary" disabled={!canSave} onClick={saveDetail}>
            Save Tool
          </Button>
        </div>
        <div className="mx-auto max-w-[1000px] p-6 max-md:p-4">
          <div className="flex items-center gap-3 border-b border-[var(--border)]">
            <div className="flex gap-1" role="tablist" aria-label="Tool sections">
              {(
                [
                  ["inputs", "Inputs", inputs.length],
                  ["parameters", "Parameters", parameters.length],
                ] as Array<["inputs" | "parameters", string, number]>
              ).map(([id, label, count]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={detailTab === id}
                  aria-controls={`tool-${id}-panel`}
                  onClick={() => setDetailTab(id)}
                  className={`flex h-11 cursor-pointer items-center gap-2 border-b-2 px-4 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${detailTab === id ? "border-[var(--green)] text-[var(--green)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                >
                  {label}
                  <Badge>{count}</Badge>
                </button>
              ))}
            </div>
            {detailTab === "parameters" && (
              <Button variant="secondary" size="sm" className="ml-auto" onClick={openNewParameter}>
                <Plus className="h-3.5 w-3.5" /> Add Parameter
              </Button>
            )}
          </div>
          {detailTab === "inputs" && (
            <section id="tool-inputs-panel" role="tabpanel" className="mt-5">
              {inputsPanel}
            </section>
          )}
          {detailTab === "parameters" && (
            <section id="tool-parameters-panel" role="tabpanel" className="mt-5">
              {parametersPanel}
            </section>
          )}
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Tools</h2>
              <Badge>{tools.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">Build Tool schemas exposed to GPT Realtime.</p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create Tool
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search Tools"
            placeholder="Search Tools"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        {tools.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--green-soft)] text-[var(--green)]">
              <Wrench className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-base font-extrabold text-[var(--text)]">Create your first Tool</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
              Create a function schema that GPT Realtime can call.
            </p>
            <Button variant="primary" className="mt-6" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create Tool
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No matching Tools</h3>
          </div>
        ) : (
          <section
            className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1"
            aria-label="Realtime Tools"
          >
            {filtered.map((tool) => {
              const ready = isValidTool(tool, dataAssets, stateSchemas);
              return (
                <article
                  key={tool.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--green-border)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => openDetail(tool)}
                    className="block w-full p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--green-soft)] text-[var(--green)]">
                        <Wrench className="h-5 w-5" />
                      </div>
                      <Badge tone={ready ? "green" : "amber"} dot>
                        {ready ? "Ready" : "Review"}
                      </Badge>
                    </div>
                    <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                      {tool.displayName}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[9px] text-[var(--green)]">{tool.name}</p>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                      {tool.description || "No description"}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4">
                      <ToolMetric label="Inputs" value={(tool.inputs ?? []).length} />
                      <ToolMetric label="Parameters" value={tool.parameters.length} />
                      <ToolMetric
                        label="Required"
                        value={tool.parameters.filter((parameter) => parameter.required).length}
                      />
                    </div>
                    <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                      Updated {formatUpdatedAt(tool.updatedAt)}
                    </p>
                  </button>
                  <div className="flex items-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={() => openDetail(tool)}>
                      <Wrench className="h-3.5 w-3.5" /> Open Tool
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip content="Edit Tool details">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(tool)}
                          aria-label={`Edit ${tool.displayName}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Duplicate Tool">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => duplicateTool(tool)}
                          aria-label={`Duplicate ${tool.displayName}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete Tool">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                          onClick={() => setPendingDeleteId(tool.id)}
                          aria-label={`Delete ${tool.displayName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      <Dialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        size="large"
        title={editingId ? "Edit Tool" : "Create Tool"}
        description="Define the Tool schema GPT Realtime receives."
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={save}>
              {editingId ? "Save" : "Create Tool"}
            </Button>
          </>
        }
      >
        <div className="max-h-[64vh] space-y-6 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Name" htmlFor="tool-display-name" error={nameError}>
              <Input
                id="tool-display-name"
                value={displayName}
                onChange={(event) => changeDisplayName(event.target.value)}
                placeholder="e.g. Record Consent"
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "tool-display-name-error" : undefined}
                autoFocus
              />
            </Field>
            <Field label="Key" htmlFor="tool-function-name">
              <Input
                id="tool-function-name"
                value={functionName}
                placeholder="record_consent"
                readOnly
                aria-readonly="true"
                className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="tool-description">
            <DataReferenceInput
              id="tool-description"
              value={description}
              onChange={setDescription}
              suggestions={bindingSuggestions}
              multiline
              placeholder="Describe when the model should call this Tool. Type @ to bind Data or State."
              className="min-h-24"
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null);
        }}
        title="Delete this tool?"
        description={pendingDelete ? `“${pendingDelete.displayName}” will be removed from this workspace.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDeleteId(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete Tool
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          Nodes currently using this Tool will have the reference removed. This action cannot be undone.
        </div>
      </Dialog>
    </main>
  );
}

function ToolMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}
