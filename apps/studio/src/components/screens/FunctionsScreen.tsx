import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Braces,
  Copy,
  GitBranch,
  ListChecks,
  LockKeyhole,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import type { DataReferenceSuggestion } from "../../domain/dataReferences";
import { listDataReferenceSuggestions } from "../../domain/dataReferences";
import {
  createFunctionAction,
  createFunctionStateUpdate,
  createServiceFunction,
  duplicateServiceFunction,
  FUNCTION_KEY_PATTERN,
  functionActionComplete,
  functionKeyFromName,
  inferPythonOutputFields,
  type FunctionAction,
  type FunctionActionType,
  type FunctionInput,
  type FunctionStateUpdateMethod,
  type FunctionStateUpdate,
  type FunctionValueType,
  type ServiceFunction,
} from "../../domain/functions";
import type { StateSchema } from "../../domain/state";
import { listStateReferenceSuggestions } from "../../domain/stateReferences";
import type { DataAsset } from "../../domain/workspaces";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { DataReferenceInput } from "../ui/DataReferenceInput";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Select, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

const PythonCodeEditor = lazy(() =>
  import("../ui/PythonCodeEditor").then((module) => ({
    default: module.PythonCodeEditor,
  })),
);

const DISPLAY_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 -]*$/;
const INPUT_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const NAME_FORMAT_ERROR = "Use English letters, numbers, spaces, and hyphens only. Start with a letter.";

const actionLabels: Record<FunctionActionType, string> = {
  code: "Code",
  state: "State",
};

const actionDescriptions: Record<FunctionActionType, string> = {
  code: "Run Python using Function inputs.",
  state: "Update runtime State fields.",
};

type MetaForm = { mode: "create" } | { mode: "edit"; id: string };

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

function functionValid(value: ServiceFunction) {
  const inputNames = value.inputs.map((input) => input.name);
  const codeActions = value.actions.filter((action) => action.type === "code");
  const outputKeys = codeActions.map((action) => action.resultKey);
  return (
    DISPLAY_NAME_PATTERN.test(value.name.trim()) &&
    FUNCTION_KEY_PATTERN.test(value.key) &&
    value.inputs.every((input) => INPUT_NAME_PATTERN.test(input.name)) &&
    new Set(inputNames).size === inputNames.length &&
    codeActions.every((action) => DISPLAY_NAME_PATTERN.test(action.outputName.trim())) &&
    new Set(outputKeys).size === outputKeys.length &&
    value.actions.length > 0 &&
    value.actions.every(functionActionComplete)
  );
}

export function FunctionsScreen({
  functions,
  dataAssets,
  stateSchemas,
  onSave,
  onDelete,
}: {
  functions: ServiceFunction[];
  dataAssets: DataAsset[];
  stateSchemas: StateSchema[];
  onSave: (serviceFunction: ServiceFunction) => void;
  onDelete: (functionId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<ServiceFunction | null>(null);
  const [metaForm, setMetaForm] = useState<MetaForm | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [nameComposing, setNameComposing] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const suggestions = useMemo(
    () => [...listDataReferenceSuggestions(dataAssets), ...listStateReferenceSuggestions(stateSchemas)],
    [dataAssets, stateSchemas],
  );
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? functions.filter((item) =>
          `${item.name} ${item.key} ${item.description}`.toLocaleLowerCase().includes(normalized),
        )
      : functions;
  }, [functions, query]);
  const pendingDelete = functions.find((item) => item.id === pendingDeleteId) ?? null;

  const openCreate = () => {
    setName("");
    setKey("");
    setDescription("");
    setNameComposing(false);
    setMetaForm({ mode: "create" });
  };
  const openEdit = (item: ServiceFunction) => {
    setName(item.name);
    setKey(item.key);
    setDescription(item.description);
    setNameComposing(false);
    setMetaForm({ mode: "edit", id: item.id });
  };
  const duplicateName = Boolean(
    metaForm &&
    functions.some(
      (item) =>
        (metaForm.mode !== "edit" || item.id !== metaForm.id) &&
        item.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
    ),
  );
  const duplicateKey = Boolean(
    metaForm && functions.some((item) => (metaForm.mode !== "edit" || item.id !== metaForm.id) && item.key === key),
  );
  const nameError =
    !nameComposing && name.length > 0 && !DISPLAY_NAME_PATTERN.test(name.trim())
      ? NAME_FORMAT_ERROR
      : duplicateName || duplicateKey
        ? "Name must be unique in this Workspace."
        : undefined;
  const metaValid = Boolean(
    DISPLAY_NAME_PATTERN.test(name.trim()) &&
    FUNCTION_KEY_PATTERN.test(key) &&
    description.trim() &&
    !duplicateName &&
    !duplicateKey,
  );
  const changeName = (value: string) => {
    setName(value);
    setKey(functionKeyFromName(value));
  };
  const submitMeta = () => {
    if (!metaForm || !metaValid) return;
    if (metaForm.mode === "create") setDraft(createServiceFunction(name, description, { key }));
    else {
      const existing = functions.find((item) => item.id === metaForm.id);
      if (existing)
        setDraft({
          ...structuredClone(existing),
          name: name.trim(),
          key,
          description: description.trim(),
        });
    }
    setMetaForm(null);
  };
  const saveDraft = () => {
    if (!draft || !functionValid(draft)) return;
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    setDraft(null);
  };

  if (draft)
    return (
      <FunctionEditor
        value={draft}
        suggestions={suggestions}
        onChange={setDraft}
        onBack={() => setDraft(null)}
        onSave={saveDraft}
      />
    );

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Functions</h2>
              <Badge>{functions.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Build reusable service logic from Data, variables, State updates, and registered runtime Handlers.
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create Function
          </Button>
        </div>
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Functions"
            aria-label="Search Functions"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>
        {functions.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--purple-soft)] text-[var(--purple)]">
              <Braces className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-base font-extrabold text-[var(--text)]">Create your first Function</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
              Combine reusable Actions without writing orchestration code.
            </p>
            <Button variant="primary" className="mt-6" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create Function
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No matching Functions</h3>
          </div>
        ) : (
          <section className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1" aria-label="Functions">
            {filtered.map((item) => (
              <article
                key={item.id}
                className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--purple-border)] hover:shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => setDraft(structuredClone(item))}
                  className="block w-full p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--purple-soft)] text-[var(--purple)]">
                      <Braces className="h-5 w-5" />
                    </div>
                    <Badge
                      tone={item.actions.length && item.actions.every(functionActionComplete) ? "green" : "amber"}
                      dot
                    >
                      {item.actions.length && item.actions.every(functionActionComplete) ? "Ready" : "Draft"}
                    </Badge>
                  </div>
                  <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                    {item.name}
                  </h3>
                  <p className="mt-1 truncate font-mono text-[9px] text-[var(--purple)]">{item.key}</p>
                  <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                    {item.description}
                  </p>
                  <div className="mt-5 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-4">
                    <Metric label="Inputs" value={item.inputs.length} />
                    <Metric label="Actions" value={item.actions.length} />
                  </div>
                  <p className="mt-4 text-[10px] text-[var(--text-muted)]">Updated {formatUpdatedAt(item.updatedAt)}</p>
                </button>
                <div className="flex items-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
                  <Button variant="ghost" size="sm" onClick={() => setDraft(structuredClone(item))}>
                    <ListChecks className="h-3.5 w-3.5" /> Open Actions
                  </Button>
                  <div className="ml-auto flex items-center gap-1">
                    <Tooltip content="Edit Function details">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => openEdit(item)}
                        aria-label={`Edit ${item.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Duplicate Function">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onSave(duplicateServiceFunction(item, functions))}
                        aria-label={`Duplicate ${item.name}`}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip content="Delete Function">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                        onClick={() => setPendingDeleteId(item.id)}
                        aria-label={`Delete ${item.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
      <Dialog
        open={Boolean(metaForm)}
        onOpenChange={(open) => {
          if (!open) setMetaForm(null);
        }}
        title={metaForm?.mode === "edit" ? "Edit Function" : "Create Function"}
        description="Define reusable service logic for your voice agents."
        footer={
          <>
            <Button variant="secondary" onClick={() => setMetaForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!metaValid} onClick={submitMeta}>
              {metaForm?.mode === "edit" ? "Continue" : "Create Function"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Name" htmlFor="function-name" error={nameError}>
              <Input
                id="function-name"
                value={name}
                onChange={(event) => changeName(event.target.value)}
                onCompositionStart={() => setNameComposing(true)}
                onCompositionEnd={(event) => {
                  setNameComposing(false);
                  changeName(event.currentTarget.value);
                }}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "function-name-error" : undefined}
                placeholder="e.g. Create Support Ticket"
                autoFocus
              />
            </Field>
            <Field label="Key" htmlFor="function-key">
              <Input
                id="function-key"
                value={key}
                readOnly
                aria-readonly="true"
                placeholder="create_support_ticket"
                className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="function-description">
            <Textarea
              id="function-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe what this Function does."
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
        title="Delete this Function?"
        description={pendingDelete ? `“${pendingDelete.name}” will be removed from this workspace.` : undefined}
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
              <Trash2 className="h-4 w-4" /> Delete Function
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          Tools connected to this Function will require review.
        </div>
      </Dialog>
    </main>
  );
}

function FunctionEditor({
  value,
  suggestions,
  onChange,
  onBack,
  onSave,
}: {
  value: ServiceFunction;
  suggestions: DataReferenceSuggestion[];
  onChange: (value: ServiceFunction) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const [tab, setTab] = useState<"inputs" | "actions">("inputs");
  const [inputDraft, setInputDraft] = useState<FunctionInput | null>(null);
  const [editingInputId, setEditingInputId] = useState<string | null>(null);
  const [actionDraft, setActionDraft] = useState<FunctionActionType | null>(null);
  const inputNames = value.inputs.map((input) => input.name);
  const inputsValid =
    value.inputs.every((input) => INPUT_NAME_PATTERN.test(input.name)) &&
    new Set(inputNames).size === inputNames.length;
  const actionsValid =
    value.actions.length > 0 &&
    value.actions.every(functionActionComplete) &&
    value.actions
      .filter((action) => action.type === "code")
      .every(
        (action, index, actions) =>
          DISPLAY_NAME_PATTERN.test(action.outputName.trim()) &&
          actions.findIndex((candidate) => candidate.resultKey === action.resultKey) === index,
      );
  const inputSuggestions: DataReferenceSuggestion[] = value.inputs.map((input) => ({
    expression: `@inputs.${input.name}`,
    reference: {
      kind: "input" as const,
      inputKey: input.name,
      path: input.name,
    },
    values: [],
    dataName: "Inputs",
    dataDescription: "Values provided when this Function runs.",
    sourceKind: "input" as const,
    valueType: input.type,
    hint: input.description || undefined,
  }));
  const openInputDialog = () => {
    setEditingInputId(null);
    setInputDraft({
      id: `input-${crypto.randomUUID()}`,
      displayName: "",
      name: "",
      description: "",
      type: "string",
      required: true,
    });
  };
  const editInput = (input: FunctionInput) => {
    setEditingInputId(input.id);
    setInputDraft({
      ...input,
      displayName:
        input.displayName ||
        input.name
          .split("_")
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(" "),
    });
  };
  const inputDraftDuplicate = Boolean(
    inputDraft && value.inputs.some((input) => input.id !== editingInputId && input.name === inputDraft.name),
  );
  const inputDraftValid = Boolean(
    inputDraft &&
    DISPLAY_NAME_PATTERN.test(inputDraft.displayName?.trim() ?? "") &&
    INPUT_NAME_PATTERN.test(inputDraft.name) &&
    !inputDraftDuplicate,
  );
  const addInput = () => {
    if (!inputDraft || !inputDraftValid) return;
    onChange({
      ...value,
      inputs: editingInputId
        ? value.inputs.map((input) => (input.id === editingInputId ? inputDraft : input))
        : [...value.inputs, inputDraft],
    });
    setInputDraft(null);
    setEditingInputId(null);
  };
  const addAction = () => {
    if (!actionDraft) return;
    onChange({
      ...value,
      actions: [...value.actions, createFunctionAction(actionDraft)],
    });
    setActionDraft(null);
  };
  const updateAction = (id: string, patch: Partial<FunctionAction>) =>
    onChange({
      ...value,
      actions: value.actions.map((action) => (action.id === id ? { ...action, ...patch } : action)),
    });
  const updateOutputName = (id: string, outputName: string) => {
    const action = value.actions.find((candidate) => candidate.id === id);
    if (!action || action.type !== "code") return;
    const previousKey = action.resultKey;
    const resultKey = functionKeyFromName(outputName);
    onChange({
      ...value,
      actions: value.actions.map((candidate) => {
        if (candidate.id === id) return { ...candidate, outputName, resultKey };
        if (candidate.type !== "state" || !previousKey) return candidate;
        return {
          ...candidate,
          updates: candidate.updates.map((update) => ({
            ...update,
            value: update.value.replaceAll(`@output.${previousKey}`, `@output.${resultKey}`),
          })),
        };
      }),
    });
  };
  const moveAction = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= value.actions.length) return;
    const actions = [...value.actions];
    [actions[index], actions[target]] = [actions[target], actions[index]];
    onChange({ ...value, actions });
  };
  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)]">
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5">
        <Tooltip content="Back to Functions">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to Functions">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-[var(--text)]">{value.name}</p>
          <p className="font-mono text-[9px] text-[var(--purple)]">{value.key}</p>
        </div>
        <Button variant="primary" disabled={!inputsValid || !actionsValid} onClick={onSave}>
          Save Function
        </Button>
      </div>
      <div className="mx-auto max-w-[1000px] p-6 max-md:p-4">
        <div className="flex items-center gap-3 border-b border-[var(--border)]">
          <div className="flex gap-1" role="tablist" aria-label="Function sections">
            {(
              [
                ["inputs", "Inputs", value.inputs.length],
                ["actions", "Actions", value.actions.length],
              ] as Array<["inputs" | "actions", string, number]>
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={`function-${id}-panel`}
                onClick={() => setTab(id)}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 border-b-2 px-4 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  tab === id
                    ? "border-[var(--purple)] text-[var(--purple)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {label}
                <Badge>{count}</Badge>
              </button>
            ))}
          </div>
          {tab === "actions" && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => setActionDraft("state")}>
              <Plus className="h-3.5 w-3.5" /> Add Action
            </Button>
          )}
        </div>

        {tab === "inputs" && (
          <section id="function-inputs-panel" role="tabpanel" className="mt-5">
            <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
              <div className="flex items-start gap-4 border-b border-[var(--purple-border)] bg-[var(--purple-soft)] px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--purple-border)] bg-[var(--surface)] text-[var(--purple)]">
                  <Braces className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-xs font-extrabold text-[var(--text)]">Inputs</h4>
                    <Badge className="border-[var(--purple-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs">
                      {value.inputs.length} fields
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-[var(--purple)]">@inputs</p>
                </div>
                <Tooltip content="The Function input namespace cannot be renamed or deleted">
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--purple-border)] bg-[var(--surface)] px-2.5 text-[9px] font-bold text-[var(--text-muted)]">
                    <LockKeyhole className="h-3 w-3" /> Locked
                  </span>
                </Tooltip>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {value.inputs.map((input) => (
                  <div
                    key={input.id}
                    className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_110px_38px] items-center gap-3 px-5 transition-colors hover:bg-[var(--surface-hover)] max-md:grid-cols-[minmax(0,1fr)_auto_38px]"
                  >
                    <button
                      type="button"
                      onClick={() => editInput(input)}
                      className="col-span-2 grid min-w-0 grid-cols-[minmax(0,1.6fr)_120px] items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] max-md:col-span-1 max-md:grid-cols-1"
                      aria-label={`Edit ${input.displayName || input.name}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-bold text-[var(--text)]">
                          {input.displayName || input.name}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[9px] text-[var(--purple)]">
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
                          onChange({
                            ...value,
                            inputs: value.inputs.map((candidate) =>
                              candidate.id === input.id
                                ? {
                                    ...candidate,
                                    required: event.target.checked,
                                  }
                                : candidate,
                            ),
                          })
                        }
                        className="h-4 w-4 accent-[var(--purple)]"
                      />
                      <span>Required</span>
                    </label>
                    <Tooltip content="Delete Input">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                        onClick={(event) => {
                          event.stopPropagation();
                          onChange({
                            ...value,
                            inputs: value.inputs.filter((candidate) => candidate.id !== input.id),
                          });
                        }}
                        aria-label={`Delete ${input.displayName || input.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                ))}
                {value.inputs.length === 0 && (
                  <div className="px-5 py-7 text-center text-[10px] text-[var(--text-muted)]">
                    No fields in this input namespace.
                  </div>
                )}
              </div>
              <div className="border-t border-[var(--border)] px-4 py-2.5">
                <Button variant="ghost" size="sm" onClick={openInputDialog}>
                  <Plus className="h-3.5 w-3.5" /> Add Field
                </Button>
              </div>
            </article>
          </section>
        )}
        {tab === "actions" && (
          <section id="function-actions-panel" role="tabpanel" className="mt-5">
            <div className="space-y-3">
              {value.actions.map((action, index) => {
                const outputSuggestions: DataReferenceSuggestion[] = value.actions
                  .slice(0, index)
                  .filter((candidate) => candidate.type === "code" && candidate.resultKey)
                  .flatMap((candidate) => {
                    const base = {
                      values: [],
                      dataName: "Output",
                      dataDescription: "Results from previous Code Actions.",
                      sourceKind: "output" as const,
                      hint: `Output from ${candidate.outputName}`,
                    };
                    return [
                      {
                        ...base,
                        expression: `@output.${candidate.resultKey}`,
                        reference: {
                          kind: "output" as const,
                          outputKey: candidate.resultKey,
                          path: candidate.resultKey,
                        },
                        valueType: "object" as const,
                      },
                      ...inferPythonOutputFields(candidate.code).map((field) => ({
                        ...base,
                        expression: `@output.${candidate.resultKey}.${field.path}`,
                        reference: {
                          kind: "output" as const,
                          outputKey: candidate.resultKey,
                          path: `${candidate.resultKey}.${field.path}`,
                        },
                        valueType: field.type,
                      })),
                    ];
                  });
                const duplicateOutput =
                  action.type === "code" &&
                  value.actions.some(
                    (candidate) =>
                      candidate.id !== action.id &&
                      candidate.type === "code" &&
                      candidate.resultKey === action.resultKey,
                  );
                return (
                  <ActionEditor
                    key={action.id}
                    action={action}
                    inputs={value.inputs}
                    index={index}
                    actionCount={value.actions.length}
                    suggestions={[...inputSuggestions, ...suggestions, ...outputSuggestions]}
                    outputError={
                      action.type === "code" && action.outputName && !DISPLAY_NAME_PATTERN.test(action.outputName)
                        ? NAME_FORMAT_ERROR
                        : duplicateOutput
                          ? "Output names must be unique."
                          : undefined
                    }
                    onMove={(direction) => moveAction(index, direction)}
                    onChange={(patch) => updateAction(action.id, patch)}
                    onOutputNameChange={(name) => updateOutputName(action.id, name)}
                    onDelete={() =>
                      onChange({
                        ...value,
                        actions: value.actions.filter((candidate) => candidate.id !== action.id),
                      })
                    }
                  />
                );
              })}
              {value.actions.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-5 py-12 text-center">
                  <GitBranch className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
                  <p className="mt-3 text-xs font-bold text-[var(--text)]">Add the first Action</p>
                  <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                    Build the execution path one reusable step at a time.
                  </p>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

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
            <Button variant="primary" disabled={!inputDraftValid} onClick={addInput}>
              {editingInputId ? "Save" : "Add Field"}
            </Button>
          </>
        }
      >
        {inputDraft && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field
                label="Name"
                htmlFor="new-function-input-display-name"
                error={
                  inputDraft.displayName && !DISPLAY_NAME_PATTERN.test(inputDraft.displayName)
                    ? NAME_FORMAT_ERROR
                    : inputDraftDuplicate
                      ? "Input names must be unique."
                      : undefined
                }
              >
                <Input
                  id="new-function-input-display-name"
                  value={inputDraft.displayName ?? ""}
                  onChange={(event) => {
                    const displayName = event.target.value;
                    setInputDraft({
                      ...inputDraft,
                      displayName,
                      name: editingInputId ? inputDraft.name : functionKeyFromName(displayName),
                    });
                  }}
                  aria-invalid={Boolean(
                    (inputDraft.displayName && !DISPLAY_NAME_PATTERN.test(inputDraft.displayName)) ||
                    inputDraftDuplicate,
                  )}
                  placeholder="Customer ID"
                  autoFocus
                />
              </Field>
              <Field label="Key" htmlFor="new-function-input-name">
                <Input
                  id="new-function-input-name"
                  value={inputDraft.name}
                  readOnly
                  aria-readonly="true"
                  className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
                  placeholder="customer_id"
                />
              </Field>
            </div>
            <Field label="Type" htmlFor="new-function-input-type">
              <Select
                id="new-function-input-type"
                value={inputDraft.type}
                onChange={(event) =>
                  setInputDraft({
                    ...inputDraft,
                    type: event.target.value as FunctionValueType,
                  })
                }
              >
                <option value="string">String</option>
                <option value="number">Number</option>
                <option value="integer">Integer</option>
                <option value="boolean">Boolean</option>
                <option value="array">Array</option>
                <option value="object">Object</option>
              </Select>
            </Field>
            <Field label="Description" htmlFor="new-function-input-description">
              <Textarea
                id="new-function-input-description"
                value={inputDraft.description}
                onChange={(event) =>
                  setInputDraft({
                    ...inputDraft,
                    description: event.target.value,
                  })
                }
                placeholder="Describe the value this Function receives."
                rows={3}
              />
            </Field>
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3.5">
              <span className="min-w-0 flex-1 text-[11px] font-bold text-[var(--text)]">Required</span>
              <input
                type="checkbox"
                checked={inputDraft.required}
                onChange={(event) =>
                  setInputDraft({
                    ...inputDraft,
                    required: event.target.checked,
                  })
                }
                className="h-4 w-4 accent-[var(--purple)]"
              />
            </label>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(actionDraft)}
        onOpenChange={(open) => {
          if (!open) setActionDraft(null);
        }}
        title="Add Function Action"
        footer={
          <>
            <Button variant="secondary" onClick={() => setActionDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={addAction}>
              Add Action
            </Button>
          </>
        }
      >
        <Field label="Action Type" htmlFor="new-function-action-type">
          <Select
            id="new-function-action-type"
            value={actionDraft ?? "state"}
            onChange={(event) => setActionDraft(event.target.value as FunctionActionType)}
            autoFocus
          >
            {Object.entries(actionLabels).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </Dialog>
    </main>
  );
}

function ActionEditor({
  action,
  inputs,
  index,
  actionCount,
  suggestions,
  outputError,
  onMove,
  onChange,
  onOutputNameChange,
  onDelete,
}: {
  action: FunctionAction;
  inputs: FunctionInput[];
  index: number;
  actionCount: number;
  suggestions: DataReferenceSuggestion[];
  outputError?: string;
  onMove: (direction: -1 | 1) => void;
  onChange: (patch: Partial<FunctionAction>) => void;
  onOutputNameChange: (name: string) => void;
  onDelete: () => void;
}) {
  const stateSuggestions = suggestions.filter((item) => item.sourceKind === "state");
  const changeType = (type: FunctionActionType) => onChange({ ...createFunctionAction(type), id: action.id });
  const updateStateUpdate = (updateId: string, patch: Partial<FunctionStateUpdate>) =>
    onChange({
      updates: action.updates.map((update) => (update.id === updateId ? { ...update, ...patch } : update)),
    });

  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
      <div className="flex items-center gap-3 border-b border-[var(--purple-border)] bg-[var(--purple-soft)] px-4 py-3">
        <span className="inline-flex h-7 shrink-0 items-center justify-center rounded-lg border border-[var(--purple-border)] bg-[var(--surface)] px-2.5 text-[10px] font-extrabold text-[var(--purple)] shadow-xs">
          Step {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold text-[var(--text)]">{actionLabels[action.type]}</p>
          <p className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">{actionDescriptions[action.type]}</p>
        </div>
        <Badge tone={functionActionComplete(action) ? "green" : "amber"} dot>
          {functionActionComplete(action) ? "Ready" : "Incomplete"}
        </Badge>
        <div className="flex items-center">
          <Tooltip content="Move up">
            <Button
              variant="ghost"
              size="icon"
              disabled={index === 0}
              className="h-8 w-8"
              onClick={() => onMove(-1)}
              aria-label={`Move action ${index + 1} up`}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Move down">
            <Button
              variant="ghost"
              size="icon"
              disabled={index === actionCount - 1}
              className="h-8 w-8"
              onClick={() => onMove(1)}
              aria-label={`Move action ${index + 1} down`}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
          <Tooltip content="Delete Action">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
              onClick={onDelete}
              aria-label={`Delete action ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <Field label="Action Type" htmlFor={`action-type-${action.id}`}>
          <Select
            id={`action-type-${action.id}`}
            value={action.type}
            onChange={(event) => changeType(event.target.value as FunctionActionType)}
          >
            {Object.entries(actionLabels).map(([type, label]) => (
              <option key={type} value={type}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {action.type === "state" && (
          <div className="space-y-3">
            <div>
              <div className="grid grid-cols-[minmax(180px,1.2fr)_130px_minmax(180px,1.2fr)_36px] gap-3 pb-2 text-xs font-semibold text-[var(--text)] max-md:hidden">
                <span>Target</span>
                <span>Method</span>
                <span>Value</span>
                <span className="sr-only">Actions</span>
              </div>
              {action.updates.map((update, updateIndex) => {
                const duplicateTarget = Boolean(
                  update.target.trim() &&
                  action.updates.some(
                    (candidate) => candidate.id !== update.id && candidate.target.trim() === update.target.trim(),
                  ),
                );
                const valueLabel = update.method === "increment" ? "Amount" : "Value";
                return (
                  <div
                    key={update.id}
                    className={cn(
                      "grid grid-cols-[minmax(180px,1.2fr)_130px_minmax(180px,1.2fr)_36px] items-start gap-3 py-3 max-md:grid-cols-1 max-md:gap-4",
                      updateIndex > 0 && "border-t border-[var(--border)]",
                    )}
                  >
                    <div className="space-y-2">
                      <label
                        htmlFor={`state-target-${update.id}`}
                        className="block text-xs font-semibold text-[var(--text)] md:sr-only"
                      >
                        Target
                      </label>
                      <DataReferenceInput
                        id={`state-target-${update.id}`}
                        value={update.target}
                        onChange={(target) => updateStateUpdate(update.id, { target })}
                        suggestions={stateSuggestions}
                        placeholder="@state.object.field"
                      />
                      {duplicateTarget && (
                        <p
                          id={`state-target-${update.id}-error`}
                          className="text-[11px] leading-5 text-[var(--red)]"
                          role="alert"
                        >
                          Target must be unique.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor={`state-method-${update.id}`}
                        className="block text-xs font-semibold text-[var(--text)] md:sr-only"
                      >
                        Method
                      </label>
                      <Select
                        id={`state-method-${update.id}`}
                        value={update.method}
                        onChange={(event) =>
                          updateStateUpdate(update.id, {
                            method: event.target.value as FunctionStateUpdateMethod,
                          })
                        }
                      >
                        <option value="replace">Replace</option>
                        <option value="merge">Merge</option>
                        <option value="append">Append</option>
                        <option value="increment">Increment</option>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label
                        htmlFor={`state-value-${update.id}`}
                        className="block text-xs font-semibold text-[var(--text)] md:sr-only"
                      >
                        {valueLabel}
                      </label>
                      <DataReferenceInput
                        id={`state-value-${update.id}`}
                        value={update.value}
                        onChange={(value) => updateStateUpdate(update.id, { value })}
                        suggestions={suggestions}
                        placeholder={
                          update.method === "increment" ? "e.g. 1 or @inputs.amount" : "Literal value or @ binding"
                        }
                      />
                    </div>
                    <Tooltip content="Delete Update">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-9 text-[var(--red)] hover:text-[var(--red)] max-md:justify-self-end"
                        onClick={() =>
                          onChange({
                            updates: action.updates.filter((candidate) => candidate.id !== update.id),
                          })
                        }
                        aria-label={`Delete state update ${updateIndex + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                );
              })}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                onChange({
                  updates: [...action.updates, createFunctionStateUpdate()],
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add Update
            </Button>
          </div>
        )}
        {action.type === "code" && (
          <div className="space-y-4">
            <Suspense
              fallback={
                <div className="h-[402px] animate-pulse rounded-xl border border-[var(--border)] bg-[var(--console)]" />
              }
            >
              <PythonCodeEditor
                id={`action-code-${action.id}`}
                value={action.code}
                inputs={inputs}
                onChange={(code) => onChange({ code })}
              />
            </Suspense>
            <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
              <Field label="Output Name" htmlFor={`action-output-name-${action.id}`} error={outputError}>
                <Input
                  id={`action-output-name-${action.id}`}
                  value={action.outputName}
                  onChange={(event) => onOutputNameChange(event.target.value)}
                  aria-invalid={Boolean(outputError)}
                  placeholder="Evaluation"
                />
              </Field>
              <Field label="Output Key" htmlFor={`action-result-${action.id}`}>
                <Input
                  id={`action-result-${action.id}`}
                  value={`@output.${action.resultKey}`}
                  readOnly
                  aria-readonly="true"
                  className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
                  placeholder="@output.evaluation"
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}
