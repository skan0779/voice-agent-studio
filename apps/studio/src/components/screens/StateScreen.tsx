import {
  ArrowLeft,
  Braces,
  Copy,
  ListTree,
  LockKeyhole,
  MemoryStick,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FlowDocument } from "../../domain/flow";
import type { DataAsset } from "../../domain/workspaces";
import {
  countStateFields,
  createStateSchema,
  defaultStateValue,
  duplicateStateSchema,
  STATE_KEY_PATTERN,
  type StateField,
  type StateFieldType,
  type StateGroup,
  type StateItemType,
  type StateSchema,
  type StateUpdateMethod,
} from "../../domain/state";
import { SYSTEM_STATE_FIELDS } from "../../domain/stateReferences";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Select, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const ENGLISH_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 -]*$/;
const NAME_FORMAT_ERROR = "Use English letters, numbers, spaces, and hyphens only. Start with a letter.";
type StateForm = { mode: "create" } | { mode: "edit"; schemaId: string };

function toKey(value: string) {
  return value
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeStateName(value: string) {
  return value.trim().toLocaleLowerCase();
}

function validStateName(value: string) {
  return ENGLISH_NAME_PATTERN.test(value.trim());
}

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

function stateTypeLabel(field: StateField) {
  return field.type === "array"
    ? `Array<${field.itemType ?? "string"}>`
    : field.type.charAt(0).toUpperCase() + field.type.slice(1);
}

function defaultPreview(value: unknown) {
  const text = typeof value === "string" ? value || "Empty string" : JSON.stringify(value);
  return text && text.length > 36 ? `${text.slice(0, 33)}…` : text || "None";
}

function validSchema(schema: StateSchema) {
  if (!validStateName(schema.name) || !STATE_KEY_PATTERN.test(schema.key)) return false;
  const groupKeys = schema.groups.map((group) => group.key);
  const groupNames = schema.groups.map((group) => normalizeStateName(group.displayName));
  if (
    groupKeys.some((key) => !KEY_PATTERN.test(key)) ||
    new Set(groupKeys).size !== groupKeys.length ||
    new Set(groupNames).size !== groupNames.length
  )
    return false;
  return schema.groups.every((group) => {
    const fieldKeys = group.fields.map((field) => field.key);
    const fieldNames = group.fields.map((field) => normalizeStateName(field.displayName));
    return (
      validStateName(group.displayName) &&
      fieldKeys.every((key) => KEY_PATTERN.test(key)) &&
      new Set(fieldKeys).size === fieldKeys.length &&
      new Set(fieldNames).size === fieldNames.length &&
      group.fields.every((field) => validStateName(field.displayName))
    );
  });
}

export function StateScreen({
  schemas,
  agents,
  dataAssets,
  onSave,
  onDelete,
}: {
  schemas: StateSchema[];
  agents: FlowDocument[];
  dataAssets: DataAsset[];
  onSave: (schema: StateSchema) => void;
  onDelete: (schemaId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<StateSchema | null>(null);
  const [form, setForm] = useState<StateForm | null>(null);
  const [formName, setFormName] = useState("");
  const [formNameComposing, setFormNameComposing] = useState(false);
  const [formKey, setFormKey] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? schemas.filter((schema) =>
          `${schema.name} ${schema.key} ${schema.description}`.toLocaleLowerCase().includes(normalized),
        )
      : schemas;
  }, [query, schemas]);
  const pendingDelete = schemas.find((schema) => schema.id === pendingDeleteId) ?? null;
  const pendingDeleteAgents = pendingDelete ? agents.filter((agent) => agent.stateSchemaId === pendingDelete.id) : [];

  const openCreate = () => {
    setFormName("");
    setFormKey("");
    setFormDescription("");
    setFormNameComposing(false);
    setForm({ mode: "create" });
  };
  const openEdit = (schema: StateSchema) => {
    setFormName(schema.name);
    setFormKey(schema.key);
    setFormDescription(schema.description);
    setFormNameComposing(false);
    setForm({ mode: "edit", schemaId: schema.id });
  };
  const submitDetails = () => {
    if (!form || !validStateName(formName) || !STATE_KEY_PATTERN.test(formKey)) return;
    if (form.mode === "create") {
      const schema = createStateSchema(formName, formDescription, {
        key: formKey,
      });
      onSave(schema);
      setDraft(structuredClone(schema));
    } else {
      const schema = schemas.find((item) => item.id === form.schemaId);
      if (schema)
        onSave({
          ...schema,
          name: formName.trim(),
          key: formKey,
          description: formDescription.trim(),
        });
    }
    setForm(null);
  };
  const duplicate = (schema: StateSchema) =>
    onSave(
      duplicateStateSchema(
        schema,
        schemas,
        dataAssets.map((asset) => asset.name),
      ),
    );
  const duplicateFormName = Boolean(
    form &&
    schemas.some(
      (schema) =>
        (form.mode !== "edit" || schema.id !== form.schemaId) &&
        normalizeStateName(schema.name) === normalizeStateName(formName),
    ),
  );
  const duplicateFormKey = Boolean(
    form && schemas.some((schema) => (form.mode !== "edit" || schema.id !== form.schemaId) && schema.key === formKey),
  );
  const dataBindingConflict = Boolean(
    formKey && dataAssets.some((asset) => asset.name.trim().toLocaleLowerCase() === formKey.toLocaleLowerCase()),
  );
  const formValid = Boolean(
    form &&
    validStateName(formName) &&
    STATE_KEY_PATTERN.test(formKey) &&
    !duplicateFormName &&
    !duplicateFormKey &&
    !dataBindingConflict,
  );
  const formNameError =
    !formNameComposing && formName.length > 0 && !validStateName(formName)
      ? NAME_FORMAT_ERROR
      : dataBindingConflict
        ? "The generated Key conflicts with an existing Data binding."
        : duplicateFormName || duplicateFormKey
          ? "Name must be unique in this Workspace."
          : undefined;
  const changeFormName = (value: string) => {
    setFormName(value);
    setFormKey(toKey(value));
  };

  if (draft) {
    return (
      <StateSchemaEditor
        key={draft.id}
        schema={draft}
        onBack={() => setDraft(null)}
        onSave={(schema) => {
          onSave({ ...schema, updatedAt: new Date().toISOString() });
          setDraft(null);
        }}
      />
    );
  }

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-end justify-between gap-4 max-sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">State</h2>
              <Badge>{schemas.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Define reusable State Schemas that create an isolated instance for every call.
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create State
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search State Schemas"
            aria-label="Search State Schemas"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        {schemas.length === 0 ? (
          <StateEmpty onCreate={openCreate} />
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No matching State Schemas</h3>
          </div>
        ) : (
          <section
            className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1"
            aria-label="State Schemas"
          >
            {filtered.map((schema) => {
              const usedBy = agents.filter((agent) => agent.stateSchemaId === schema.id);
              return (
                <article
                  key={schema.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--blue-border)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => setDraft(structuredClone(schema))}
                    className="block w-full cursor-pointer p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--blue-soft)] text-[var(--blue)]">
                        <MemoryStick className="h-5 w-5" />
                      </div>
                      <Badge tone={usedBy.length ? "green" : "amber"} dot>
                        {usedBy.length ? "In Use" : "Unused"}
                      </Badge>
                    </div>
                    <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                      {schema.name}
                    </h3>
                    <p className="mt-1 truncate font-mono text-[9px] text-[var(--blue)]">{schema.key}</p>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                      {schema.description || "No description"}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4">
                      <StateMetric label="Objects" value={schema.groups.length} />
                      <StateMetric label="Fields" value={countStateFields(schema)} />
                      <StateMetric label="Agents" value={usedBy.length} />
                    </div>
                    <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                      Updated {formatUpdatedAt(schema.updatedAt)}
                    </p>
                  </button>
                  <div className="flex items-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={() => setDraft(structuredClone(schema))}>
                      <Braces className="h-3.5 w-3.5" /> Open Schema
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip content="Edit State details">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(schema)}
                          aria-label={`Edit ${schema.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Duplicate State Schema">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => duplicate(schema)}
                          aria-label={`Duplicate ${schema.name}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip
                        content={
                          usedBy.length ? "Detach this State from its Agents before deleting" : "Delete State Schema"
                        }
                      >
                        <span className="inline-flex">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={usedBy.length > 0}
                            className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                            onClick={() => setPendingDeleteId(schema.id)}
                            aria-label={`Delete ${schema.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </span>
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
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={form?.mode === "edit" ? "Edit State" : "Create State"}
        description={
          form?.mode === "edit"
            ? "Update how this State appears in the workspace."
            : "Create a reusable Schema. Every call receives a separate State instance."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!formValid} onClick={submitDetails}>
              {form?.mode === "edit" ? "Save Changes" : "Create State"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
            <Field label="Name" htmlFor="state-name" error={formNameError}>
              <Input
                id="state-name"
                value={formName}
                onChange={(event) => changeFormName(event.target.value)}
                onCompositionStart={() => setFormNameComposing(true)}
                onCompositionEnd={(event) => {
                  setFormNameComposing(false);
                  changeFormName(event.currentTarget.value);
                }}
                aria-invalid={Boolean(formNameError)}
                aria-describedby={formNameError ? "state-name-error" : undefined}
                placeholder="e.g. Customer Support State"
                autoFocus
              />
            </Field>
            <Field label="Key" htmlFor="state-key">
              <Input
                id="state-key"
                value={formKey}
                placeholder="on_call_state"
                readOnly
                aria-readonly="true"
                className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
              />
            </Field>
          </div>
          <Field label="Description" htmlFor="state-description">
            <Textarea
              id="state-description"
              value={formDescription}
              onChange={(event) => setFormDescription(event.target.value)}
              placeholder="Describe what this State tracks."
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
        title="Delete this State Schema?"
        description={pendingDelete ? `“${pendingDelete.name}” will be removed from this workspace.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pendingDeleteAgents.length > 0}
              onClick={() => {
                if (pendingDelete) onDelete(pendingDelete.id);
                setPendingDeleteId(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete State
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          {pendingDeleteAgents.length
            ? `Used by ${pendingDeleteAgents.map((agent) => agent.name).join(", ")}. Detach it before deleting.`
            : "This action cannot be undone."}
        </div>
      </Dialog>
    </main>
  );
}

function StateSchemaEditor({
  schema,
  onBack,
  onSave,
}: {
  schema: StateSchema;
  onBack: () => void;
  onSave: (schema: StateSchema) => void;
}) {
  const [tab, setTab] = useState<"system" | "custom">("custom");
  const [draft, setDraft] = useState(() => structuredClone(schema));
  const [groupDraft, setGroupDraft] = useState<StateGroup | null>(null);
  const [groupMode, setGroupMode] = useState<"create" | "edit">("create");
  const [fieldDraft, setFieldDraft] = useState<{
    groupId: string;
    field: StateField;
    mode: "create" | "edit";
  } | null>(null);
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);
  const [pendingField, setPendingField] = useState<{
    groupId: string;
    fieldId: string;
  } | null>(null);
  const canSave = validSchema(draft);

  const openGroup = (group?: StateGroup) => {
    setGroupMode(group ? "edit" : "create");
    setGroupDraft(
      group
        ? structuredClone(group)
        : {
            id: `group-${crypto.randomUUID()}`,
            displayName: "",
            key: "",
            fields: [],
          },
    );
  };
  const saveGroup = () => {
    if (!groupDraft || !validStateName(groupDraft.displayName) || !KEY_PATTERN.test(groupDraft.key)) return;
    const normalizedGroup = {
      ...groupDraft,
      displayName: groupDraft.displayName.trim(),
    };
    setDraft((current) => ({
      ...current,
      groups:
        groupMode === "edit"
          ? current.groups.map((group) => (group.id === normalizedGroup.id ? normalizedGroup : group))
          : [...current.groups, normalizedGroup],
    }));
    setGroupDraft(null);
  };
  const openField = (groupId: string, field?: StateField) =>
    setFieldDraft({
      groupId,
      mode: field ? "edit" : "create",
      field: field
        ? structuredClone(field)
        : {
            id: `field-${crypto.randomUUID()}`,
            displayName: "",
            key: "",
            description: "",
            type: "string",
            defaultValue: "",
            updateMethod: "replace",
            readOnly: false,
          },
    });
  const saveField = () => {
    if (!fieldDraft || !validStateName(fieldDraft.field.displayName) || !KEY_PATTERN.test(fieldDraft.field.key)) return;
    const normalizedField = {
      ...fieldDraft.field,
      displayName: fieldDraft.field.displayName.trim(),
    };
    setDraft((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id !== fieldDraft.groupId
          ? group
          : {
              ...group,
              fields:
                fieldDraft.mode === "edit"
                  ? group.fields.map((field) => (field.id === normalizedField.id ? normalizedField : field))
                  : [...group.fields, normalizedField],
            },
      ),
    }));
    setFieldDraft(null);
  };
  const updateFieldReadOnly = (groupId: string, fieldId: string, readOnly: boolean) =>
    setDraft((current) => ({
      ...current,
      groups: current.groups.map((group) =>
        group.id !== groupId
          ? group
          : {
              ...group,
              fields: group.fields.map((field) => (field.id === fieldId ? { ...field, readOnly } : field)),
            },
      ),
    }));

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)]">
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-5">
        <Tooltip content="Back to State">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to State">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Tooltip>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-extrabold text-[var(--text)]">{draft.name || "Untitled State"}</p>
          <p className="font-mono text-[9px] text-[var(--text-muted)]">{draft.key}</p>
        </div>
        <Button variant="primary" disabled={!canSave} onClick={() => onSave(draft)}>
          Save State
        </Button>
      </div>
      <div className="mx-auto max-w-[1080px] p-6 max-md:p-4">
        <div className="flex items-center gap-3 border-b border-[var(--border)]">
          <div className="flex gap-1" role="tablist" aria-label="State sections">
            {(
              [
                ["custom", "Custom State", draft.groups.length],
                ["system", "System State", SYSTEM_STATE_FIELDS.length],
              ] as Array<["system" | "custom", string, number]>
            ).map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                aria-controls={`state-${id}-panel`}
                onClick={() => setTab(id)}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-2 border-b-2 px-4 text-xs font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  tab === id
                    ? "border-[var(--blue)] text-[var(--blue)]"
                    : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
                )}
              >
                {label}
                <Badge>{count}</Badge>
              </button>
            ))}
          </div>
          {tab === "custom" && (
            <Button variant="secondary" size="sm" className="ml-auto" onClick={() => openGroup()}>
              <Plus className="h-3.5 w-3.5" /> Add Object
            </Button>
          )}
        </div>

        {tab === "system" && (
          <section id="state-system-panel" role="tabpanel" className="mt-5">
            <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
              <div className="flex items-start gap-4 border-b border-[var(--blue-border)] bg-[var(--blue-soft)] px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--blue-border)] bg-[var(--surface)] text-[var(--blue)]">
                  <LockKeyhole className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="truncate text-xs font-extrabold text-[var(--text)]">System</h4>
                    <Badge className="border-[var(--blue-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs">
                      {SYSTEM_STATE_FIELDS.length} fields
                    </Badge>
                  </div>
                  <p className="mt-1 font-mono text-[9px] text-[var(--blue)]">@state.system</p>
                </div>
                <Tooltip content="System State is managed by the Runtime and cannot be edited">
                  <span className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--blue-border)] bg-[var(--surface)] px-2.5 text-[9px] font-bold text-[var(--text-muted)]">
                    <LockKeyhole className="h-3 w-3" /> Locked
                  </span>
                </Tooltip>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {SYSTEM_STATE_FIELDS.map((field) => (
                  <div
                    key={field.id}
                    className="grid grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1fr)_38px] items-center gap-3 px-5 py-3 max-md:grid-cols-[1fr_auto]"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold text-[var(--text)]">{field.displayName}</p>
                      <p className="mt-1 truncate font-mono text-[9px] text-[var(--blue)]">@state.system.{field.key}</p>
                    </div>
                    <Badge>{stateTypeLabel(field)}</Badge>
                    <div className="min-w-0 max-md:hidden">
                      <p className="text-[9px] text-[var(--text-muted)]">Source</p>
                      <p className="mt-1 truncate text-[10px] text-[var(--text-secondary)]">Runtime</p>
                    </div>
                    <Tooltip content="Read only">
                      <span
                        className="flex h-8 w-8 items-center justify-center text-[var(--text-muted)]"
                        aria-label={`${field.displayName} is read only`}
                      >
                        <LockKeyhole className="h-3.5 w-3.5" />
                      </span>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </article>
          </section>
        )}

        {tab === "custom" && (
          <section id="state-custom-panel" role="tabpanel" className="mt-5">
            {draft.groups.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-14 text-center">
                <ListTree className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
                <h4 className="mt-3 text-xs font-bold text-[var(--text)]">Add your first State object</h4>
                <p className="mt-1.5 text-[10px] text-[var(--text-muted)]">
                  Objects become namespaces such as @state.screening.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {draft.groups.map((group) => (
                  <article
                    key={group.id}
                    className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs"
                  >
                    <div className="flex items-start gap-4 border-b border-[var(--blue-border)] bg-[var(--blue-soft)] px-5 py-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--blue-border)] bg-[var(--surface)] text-[var(--blue)]">
                        <ListTree className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate text-xs font-extrabold text-[var(--text)]">{group.displayName}</h4>
                          <Badge className="border-[var(--blue-border)] bg-[var(--surface)] text-[var(--text-secondary)] shadow-xs">
                            {group.fields.length} fields
                          </Badge>
                        </div>
                        <p className="mt-1 font-mono text-[9px] text-[var(--blue)]">@state.{group.key}</p>
                      </div>
                      <Tooltip content="Edit object">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openGroup(group)}
                          aria-label={`Edit ${group.displayName}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete object">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                          onClick={() => setPendingGroupId(group.id)}
                          aria-label={`Delete ${group.displayName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                    </div>
                    <div className="divide-y divide-[var(--border)]">
                      {group.fields.map((field) => (
                        <div
                          key={field.id}
                          className="grid w-full grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1fr)_110px_38px] items-center gap-3 px-5 transition-colors hover:bg-[var(--surface-hover)] max-md:grid-cols-[minmax(0,1fr)_auto_38px]"
                        >
                          <button
                            type="button"
                            onClick={() => openField(group.id, field)}
                            className="col-span-3 grid min-w-0 grid-cols-[minmax(0,1.6fr)_120px_minmax(0,1fr)] items-center gap-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)] max-md:col-span-1 max-md:grid-cols-1"
                            aria-label={`Edit ${field.displayName}`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-[11px] font-bold text-[var(--text)]">
                                {field.displayName}
                              </span>
                              <span className="mt-1 block truncate font-mono text-[9px] text-[var(--blue)]">
                                @state.{group.key}.{field.key}
                              </span>
                            </span>
                            <Badge className="max-md:hidden">{stateTypeLabel(field)}</Badge>
                            <span className="min-w-0 max-md:hidden">
                              <span className="block text-[9px] text-[var(--text-muted)]">Default</span>
                              <span className="mt-1 block truncate font-mono text-[10px] text-[var(--text-secondary)]">
                                {defaultPreview(field.defaultValue)}
                              </span>
                            </span>
                          </button>
                          <label className="flex cursor-pointer items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]">
                            <input
                              type="checkbox"
                              checked={field.readOnly}
                              onChange={(event) => updateFieldReadOnly(group.id, field.id, event.target.checked)}
                              className="h-4 w-4 accent-[var(--blue)]"
                            />
                            <span>Read Only</span>
                          </label>
                          <Tooltip content="Delete field">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPendingField({
                                  groupId: group.id,
                                  fieldId: field.id,
                                });
                              }}
                              aria-label={`Delete ${field.displayName}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        </div>
                      ))}
                      {group.fields.length === 0 && (
                        <div className="px-5 py-7 text-center text-[10px] text-[var(--text-muted)]">
                          No fields in this object.
                        </div>
                      )}
                    </div>
                    <div className="border-t border-[var(--border)] px-4 py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => openField(group.id)}>
                        <Plus className="h-3.5 w-3.5" /> Add Field
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      <GroupDialog
        draft={groupDraft}
        mode={groupMode}
        groups={draft.groups}
        onChange={setGroupDraft}
        onClose={() => setGroupDraft(null)}
        onSave={saveGroup}
      />
      <FieldDialog
        draft={fieldDraft}
        groups={draft.groups}
        onChange={setFieldDraft}
        onClose={() => setFieldDraft(null)}
        onSave={saveField}
      />
      <Dialog
        open={Boolean(pendingGroupId)}
        onOpenChange={(open) => {
          if (!open) setPendingGroupId(null);
        }}
        title="Delete this State object?"
        description="Every field and binding path in this object will be removed."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingGroupId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDraft((current) => ({
                  ...current,
                  groups: current.groups.filter((group) => group.id !== pendingGroupId),
                }));
                setPendingGroupId(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete Object
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          Existing State bindings for this object will require review.
        </div>
      </Dialog>
      <Dialog
        open={Boolean(pendingField)}
        onOpenChange={(open) => {
          if (!open) setPendingField(null);
        }}
        title="Delete this State field?"
        description="Instructions, Tools, or Functions using this binding may need review."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingField(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pendingField)
                  setDraft((current) => ({
                    ...current,
                    groups: current.groups.map((group) =>
                      group.id === pendingField.groupId
                        ? {
                            ...group,
                            fields: group.fields.filter((field) => field.id !== pendingField.fieldId),
                          }
                        : group,
                    ),
                  }));
                setPendingField(null);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete Field
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          This State path will no longer resolve after saving.
        </div>
      </Dialog>
    </main>
  );
}

function GroupDialog({
  draft,
  mode,
  groups,
  onChange,
  onClose,
  onSave,
}: {
  draft: StateGroup | null;
  mode: "create" | "edit";
  groups: StateGroup[];
  onChange: (group: StateGroup | null) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [nameComposing, setNameComposing] = useState(false);
  const duplicateName = draft
    ? groups.some(
        (group) =>
          group.id !== draft.id && normalizeStateName(group.displayName) === normalizeStateName(draft.displayName),
      )
    : false;
  const duplicateKey = draft ? groups.some((group) => group.id !== draft.id && group.key === draft.key) : false;
  const canSave = Boolean(
    draft && validStateName(draft.displayName) && KEY_PATTERN.test(draft.key) && !duplicateName && !duplicateKey,
  );
  const changeName = (value: string) => {
    if (!draft) return;
    onChange({
      ...draft,
      displayName: value,
      key: toKey(value),
    });
  };
  const nameError =
    !nameComposing && Boolean(draft?.displayName) && !validStateName(draft?.displayName ?? "")
      ? NAME_FORMAT_ERROR
      : duplicateName || duplicateKey
        ? "Name must be unique in this State."
        : undefined;
  return (
    <Dialog
      open={Boolean(draft)}
      onOpenChange={(open) => {
        if (!open) {
          setNameComposing(false);
          onClose();
        }
      }}
      title={mode === "edit" ? "Edit State Object" : "Add State Object"}
      description="Objects become namespaces in State bindings."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={onSave}>
            {mode === "edit" ? "Save" : "Add Object"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
        {draft && (
          <>
            <Field label="Name" htmlFor="state-group-name" error={nameError}>
              <Input
                id="state-group-name"
                value={draft.displayName}
                onChange={(event) => changeName(event.target.value)}
                onCompositionStart={() => setNameComposing(true)}
                onCompositionEnd={(event) => {
                  setNameComposing(false);
                  changeName(event.currentTarget.value);
                }}
                aria-invalid={Boolean(nameError)}
                aria-describedby={nameError ? "state-group-name-error" : undefined}
                placeholder="e.g. Screening"
                autoFocus
              />
            </Field>
            <Field label="Key" htmlFor="state-group-key">
              <Input
                id="state-group-key"
                value={draft.key}
                placeholder="screening"
                readOnly
                aria-readonly="true"
                className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
              />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}

function FieldDialog({
  draft,
  groups,
  onChange,
  onClose,
  onSave,
}: {
  draft: { groupId: string; field: StateField; mode: "create" | "edit" } | null;
  groups: StateGroup[];
  onChange: (
    draft: {
      groupId: string;
      field: StateField;
      mode: "create" | "edit";
    } | null,
  ) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [nameComposing, setNameComposing] = useState(false);
  const group = groups.find((candidate) => candidate.id === draft?.groupId);
  const duplicateName = Boolean(
    draft &&
    group?.fields.some(
      (field) =>
        field.id !== draft.field.id &&
        normalizeStateName(field.displayName) === normalizeStateName(draft.field.displayName),
    ),
  );
  const duplicateKey = Boolean(
    draft && group?.fields.some((field) => field.id !== draft.field.id && field.key === draft.field.key),
  );
  const canSave = Boolean(
    draft &&
    validStateName(draft.field.displayName) &&
    KEY_PATTERN.test(draft.field.key) &&
    !duplicateName &&
    !duplicateKey,
  );
  const update = (patch: Partial<StateField>) => {
    if (draft) onChange({ ...draft, field: { ...draft.field, ...patch } });
  };
  const changeName = (value: string) => {
    if (!draft) return;
    update({
      displayName: value,
      key: toKey(value),
    });
  };
  const changeType = (type: StateFieldType) =>
    update({
      type,
      itemType: type === "array" ? "string" : undefined,
      defaultValue: defaultStateValue(type),
      enumValues: type === "boolean" || type === "array" || type === "object" ? undefined : draft?.field.enumValues,
      updateMethod: type === "array" ? "append" : type === "object" ? "merge" : "replace",
    });
  const methods: StateUpdateMethod[] =
    draft?.field.type === "array"
      ? ["replace", "append"]
      : draft?.field.type === "object"
        ? ["replace", "merge"]
        : draft?.field.type === "number" || draft?.field.type === "integer"
          ? ["replace", "increment"]
          : ["replace"];
  const addEnum = () => update({ enumValues: [...(draft?.field.enumValues ?? []), ""] });
  const updateEnum = (index: number, value: string) =>
    update({
      enumValues: (draft?.field.enumValues ?? []).map((item, itemIndex) =>
        itemIndex === index
          ? draft?.field.type === "number" || draft?.field.type === "integer"
            ? Number(value)
            : value
          : item,
      ),
    });
  const nameError =
    !nameComposing && Boolean(draft?.field.displayName) && !validStateName(draft?.field.displayName ?? "")
      ? NAME_FORMAT_ERROR
      : duplicateName || duplicateKey
        ? "Name must be unique in this Object."
        : undefined;
  return (
    <Dialog
      open={Boolean(draft)}
      onOpenChange={(open) => {
        if (!open) {
          setNameComposing(false);
          onClose();
        }
      }}
      size="large"
      title={draft?.mode === "edit" ? "Edit State Field" : "Add State Field"}
      description={group ? `Add a typed value to @state.${group.key}.` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSave} onClick={onSave}>
            {draft?.mode === "edit" ? "Save" : "Add Field"}
          </Button>
        </>
      }
    >
      <div className="max-h-[64vh] space-y-5 overflow-y-auto pr-1">
        {draft && (
          <>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field label="Name" htmlFor="state-field-name" error={nameError}>
                <Input
                  id="state-field-name"
                  value={draft.field.displayName}
                  onChange={(event) => changeName(event.target.value)}
                  onCompositionStart={() => setNameComposing(true)}
                  onCompositionEnd={(event) => {
                    setNameComposing(false);
                    changeName(event.currentTarget.value);
                  }}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "state-field-name-error" : undefined}
                  placeholder="e.g. Current Item ID"
                  autoFocus
                />
              </Field>
              <Field label="Key" htmlFor="state-field-key">
                <Input
                  id="state-field-key"
                  value={draft.field.key}
                  placeholder="current_item_id"
                  readOnly
                  aria-readonly="true"
                  className="cursor-not-allowed bg-[var(--surface-subtle)] font-mono text-[var(--text-muted)]"
                />
              </Field>
            </div>
            <Field label="Description" htmlFor="state-field-description">
              <Textarea
                id="state-field-description"
                value={draft.field.description}
                onChange={(event) => update({ description: event.target.value })}
                className="min-h-20"
              />
            </Field>
            <div className="grid grid-cols-2 gap-4 max-sm:grid-cols-1">
              <Field label="Type" htmlFor="state-field-type">
                <Select
                  id="state-field-type"
                  value={draft.field.type}
                  onChange={(event) => changeType(event.target.value as StateFieldType)}
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="integer">Integer</option>
                  <option value="boolean">Boolean</option>
                  <option value="array">Array</option>
                  <option value="object">Object</option>
                </Select>
              </Field>
              <Field label="Update Method" htmlFor="state-field-update">
                <Select
                  id="state-field-update"
                  value={draft.field.updateMethod}
                  onChange={(event) =>
                    update({
                      updateMethod: event.target.value as StateUpdateMethod,
                    })
                  }
                >
                  {methods.map((method) => (
                    <option key={method} value={method}>
                      {method.charAt(0).toUpperCase() + method.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {draft.field.type === "array" && (
              <Field label="Item Type" htmlFor="state-field-item-type">
                <Select
                  id="state-field-item-type"
                  value={draft.field.itemType ?? "string"}
                  onChange={(event) =>
                    update({
                      itemType: event.target.value as StateItemType,
                      defaultValue: [],
                    })
                  }
                >
                  <option value="string">String</option>
                  <option value="number">Number</option>
                  <option value="integer">Integer</option>
                  <option value="boolean">Boolean</option>
                </Select>
              </Field>
            )}
            <DefaultValueEditor field={draft.field} onChange={(defaultValue) => update({ defaultValue })} />
            {!["boolean", "array", "object"].includes(draft.field.type) && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-[var(--text-secondary)]">Enum</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-full px-2.5 text-[9px]"
                    onClick={addEnum}
                  >
                    <Plus className="h-3 w-3" /> Add Value
                  </Button>
                </div>
                <div className="space-y-2">
                  {(draft.field.enumValues ?? []).map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={String(value)}
                        type={draft.field.type === "string" ? "text" : "number"}
                        onChange={(event) => updateEnum(index, event.target.value)}
                        className="font-mono"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[var(--red)] hover:text-[var(--red)]"
                        onClick={() =>
                          update({
                            enumValues: draft.field.enumValues?.filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                        aria-label={`Delete enum value ${index + 1}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold text-[var(--text)]">Read Only</span>
                <span className="mt-1 block text-[9px] text-[var(--text-muted)]">
                  Functions cannot update this field.
                </span>
              </span>
              <input
                type="checkbox"
                checked={draft.field.readOnly}
                onChange={(event) => update({ readOnly: event.target.checked })}
                className="h-4 w-4 accent-[var(--blue)]"
              />
            </label>
          </>
        )}
      </div>
    </Dialog>
  );
}

function DefaultValueEditor({ field, onChange }: { field: StateField; onChange: (value: unknown) => void }) {
  if (field.type === "boolean")
    return (
      <Field label="Default Value" htmlFor="state-default-boolean">
        <Select
          id="state-default-boolean"
          value={String(Boolean(field.defaultValue))}
          onChange={(event) => onChange(event.target.value === "true")}
        >
          <option value="false">False</option>
          <option value="true">True</option>
        </Select>
      </Field>
    );
  if (field.type === "array" || field.type === "object")
    return <JsonDefaultValueEditor field={field} onChange={onChange} />;
  return (
    <Field label="Default Value" htmlFor="state-default-value">
      <Input
        id="state-default-value"
        type={field.type === "string" ? "text" : "number"}
        step={field.type === "integer" ? 1 : "any"}
        value={String(field.defaultValue ?? "")}
        onChange={(event) => onChange(field.type === "string" ? event.target.value : Number(event.target.value))}
      />
    </Field>
  );
}

function JsonDefaultValueEditor({ field, onChange }: { field: StateField; onChange: (value: unknown) => void }) {
  const serialized = JSON.stringify(field.defaultValue, null, 2);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState("");

  useEffect(() => {
    setText(serialized);
    setError("");
  }, [field.type, serialized]);

  const update = (next: string) => {
    setText(next);
    try {
      const parsed = JSON.parse(next);
      const validShape =
        field.type === "array"
          ? Array.isArray(parsed)
          : Boolean(parsed) && typeof parsed === "object" && !Array.isArray(parsed);
      if (!validShape) {
        setError(field.type === "array" ? "Enter a JSON array." : "Enter a JSON object.");
        return;
      }
      setError("");
      onChange(parsed);
    } catch {
      setError("Enter valid JSON.");
    }
  };

  return (
    <Field label="Default Value" htmlFor="state-default-json" hint={error || "Enter valid JSON."}>
      <Textarea
        id="state-default-json"
        value={text}
        onChange={(event) => update(event.target.value)}
        aria-invalid={Boolean(error)}
        className="min-h-24 font-mono text-[11px]"
      />
    </Field>
  );
}

function StateMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}
function StateEmpty({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--blue-soft)] text-[var(--blue)]">
        <MemoryStick className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-base font-extrabold text-[var(--text)]">Create your first State Schema</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        Define typed runtime values without writing JSON.
      </p>
      <Button variant="primary" className="mt-6" onClick={onCreate}>
        <Plus className="h-4 w-4" /> Create State
      </Button>
    </div>
  );
}
