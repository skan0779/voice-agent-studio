import { Building2, Check, Copy, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import type { WorkspaceDocument } from "../../domain/workspaces";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

type WorkspaceForm = { mode: "create" } | { mode: "edit"; workspaceId: string };

export function WorkspacesScreen({
  workspaces,
  activeWorkspaceId,
  onSelect,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  workspaces: WorkspaceDocument[];
  activeWorkspaceId: string | null;
  onSelect: (workspaceId: string) => void;
  onCreate: (name: string, description: string) => void;
  onUpdate: (workspaceId: string, name: string, description: string) => void;
  onDuplicate: (workspaceId: string) => void;
  onDelete: (workspaceId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<WorkspaceForm | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return normalized
      ? workspaces.filter((workspace) =>
          `${workspace.name} ${workspace.description}`.toLocaleLowerCase().includes(normalized),
        )
      : workspaces;
  }, [query, workspaces]);
  const pendingDelete = workspaces.find((workspace) => workspace.id === pendingDeleteId) ?? null;

  const openCreate = () => {
    setName("");
    setDescription("");
    setForm({ mode: "create" });
  };
  const openEdit = (workspace: WorkspaceDocument) => {
    setName(workspace.name);
    setDescription(workspace.description);
    setForm({ mode: "edit", workspaceId: workspace.id });
  };
  const submit = () => {
    if (!form || !name.trim()) return;
    if (form.mode === "create") onCreate(name, description);
    else onUpdate(form.workspaceId, name, description);
    setForm(null);
  };

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-end justify-between gap-4 max-sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Workspaces</h2>
              <Badge>{workspaces.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Select a workspace or manage its agents, tools, data, and records.
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create Workspace
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        {workspaces.length === 0 ? (
          <EmptyWorkspace onCreate={openCreate} />
        ) : filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No matching workspaces</h3>
          </div>
        ) : (
          <section
            className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1"
            aria-label="Workspaces"
          >
            {filtered.map((workspace) => {
              const active = workspace.id === activeWorkspaceId;
              return (
                <article
                  key={workspace.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--blue-border)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => onSelect(workspace.id)}
                    className="block w-full cursor-pointer p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--purple-soft)] text-[var(--purple)]">
                        <Building2 className="h-5 w-5" />
                      </div>
                      {active && (
                        <Badge tone="green" dot>
                          Active
                        </Badge>
                      )}
                    </div>
                    <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                      {workspace.name}
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                      {workspace.description || "No description"}
                    </p>
                    <div className="mt-5 grid grid-cols-4 gap-2 border-t border-[var(--border)] pt-4">
                      <Metric label="Agents" value={workspace.agents.length} />
                      <Metric label="Tools" value={workspace.tools.length} />
                      <Metric label="Data" value={workspace.dataAssets.length} />
                      <Metric label="Records" value={workspace.calls.length} />
                    </div>
                    <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                      Updated {formatUpdatedAt(workspace.updatedAt)}
                    </p>
                  </button>
                  <div className="flex items-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={() => onSelect(workspace.id)}>
                      {active ? <Check className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                      {active ? "Open Workspace" : "Select Workspace"}
                    </Button>
                    <div className="ml-auto flex gap-1">
                      <Tooltip content="Edit workspace">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(workspace)}
                          aria-label={`Edit ${workspace.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Duplicate workspace">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onDuplicate(workspace.id)}
                          aria-label={`Duplicate ${workspace.name}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete workspace">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                          onClick={() => setPendingDeleteId(workspace.id)}
                          aria-label={`Delete ${workspace.name}`}
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
        open={Boolean(form)}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
        title={form?.mode === "edit" ? "Edit Workspace" : "Create Workspace"}
        description={
          form?.mode === "edit"
            ? "Update this workspace's name and description."
            : "Create an isolated space for agents, connections, and environment settings."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!name.trim()} onClick={submit}>
              {form?.mode === "edit" ? "Save Changes" : "Create Workspace"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="Workspace Name" htmlFor="workspace-name">
            <Input
              id="workspace-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Customer Support"
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="workspace-description">
            <Textarea
              id="workspace-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe this workspace."
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
        title="Delete this workspace?"
        description="All agents and workspace settings inside it will be removed."
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
              <Trash2 className="h-4 w-4" /> Delete Workspace
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <div className="rounded-xl border border-[var(--danger-soft)] bg-[var(--danger-soft)]/55 p-4">
            <p className="text-sm font-bold text-[var(--text)]">{pendingDelete.name}</p>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
              {pendingDelete.agents.length} agent{pendingDelete.agents.length === 1 ? "" : "s"} will also be deleted.
            </p>
          </div>
        )}
      </Dialog>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}

function EmptyWorkspace({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--purple-soft)] text-[var(--purple)]">
        <Building2 className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-base font-extrabold text-[var(--text)]">Create your first workspace</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        Organize agents, shared connections, and environment settings in one place.
      </p>
      <Button variant="primary" className="mt-6" onClick={onCreate}>
        <Plus className="h-4 w-4" /> Create Workspace
      </Button>
    </div>
  );
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
}
