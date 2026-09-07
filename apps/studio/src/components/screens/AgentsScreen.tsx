import { Bot, Copy, Pencil, Plus, Search, Trash2, Workflow } from "lucide-react";
import { useMemo, useState } from "react";
import type { FlowDocument } from "../../domain/flow";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field, Input, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";

type AgentForm = { mode: "create" } | { mode: "edit"; agentId: string };

export function AgentsScreen({
  agents,
  onOpen,
  onCreate,
  onUpdate,
  onDuplicate,
  onDelete,
}: {
  agents: FlowDocument[];
  onOpen: (agentId: string) => void;
  onCreate: (name: string, description: string) => void;
  onUpdate: (agentId: string, name: string, description: string) => void;
  onDuplicate: (agentId: string) => void;
  onDelete: (agentId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<AgentForm | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return agents;
    return agents.filter((agent) => `${agent.name} ${agent.description}`.toLocaleLowerCase().includes(normalizedQuery));
  }, [agents, query]);
  const pendingDelete = agents.find((agent) => agent.id === pendingDeleteId) ?? null;

  const openCreate = () => {
    setName("");
    setDescription("");
    setForm({ mode: "create" });
  };
  const openEdit = (agent: FlowDocument) => {
    setName(agent.name);
    setDescription(agent.description);
    setForm({ mode: "edit", agentId: agent.id });
  };
  const submit = () => {
    if (!name.trim() || !form) return;
    if (form.mode === "create") onCreate(name, description);
    else onUpdate(form.agentId, name, description);
    setForm(null);
  };

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div className="flex items-end justify-between gap-4 max-sm:items-start">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Agents</h2>
              <Badge>{agents.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Create and manage voice agents for this workspace.
            </p>
          </div>
          <Button variant="primary" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Create Agent
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 shadow-xs">
          <Search className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search agents"
            aria-label="Search agents"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        {agents.length === 0 ? (
          <EmptyState onCreate={openCreate} />
        ) : filteredAgents.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-16 text-center">
            <Search className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No matching agents</h3>
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">Try another name or description.</p>
          </div>
        ) : (
          <section
            className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1"
            aria-label="Voice agents"
          >
            {filteredAgents.map((agent) => {
              const toolCount = new Set(agent.nodes.flatMap((node) => node.data.toolIds)).size;
              return (
                <article
                  key={agent.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--blue-border)] hover:shadow-lg"
                >
                  <button
                    type="button"
                    onClick={() => onOpen(agent.id)}
                    className="block w-full cursor-pointer p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--blue-soft)] text-[var(--blue)]">
                        <Bot className="h-5 w-5" />
                      </div>
                      <Badge tone={agent.status === "published" ? "green" : "amber"} dot>
                        {agent.status === "published" ? "Deployed" : "Not Deployed"}
                      </Badge>
                    </div>
                    <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                      {agent.name}
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                      {agent.description || "No description"}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4">
                      <AgentMetric label="Blocks" value={agent.nodes.length} />
                      <AgentMetric label="Edges" value={agent.edges.length} />
                      <AgentMetric label="Tools" value={toolCount} />
                    </div>
                    <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                      Updated {formatUpdatedAt(agent.updatedAt)}
                    </p>
                  </button>
                  <div className="flex items-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
                    <Button variant="ghost" size="sm" onClick={() => onOpen(agent.id)}>
                      <Workflow className="h-3.5 w-3.5" /> Open Builder
                    </Button>
                    <div className="ml-auto flex items-center gap-1">
                      <Tooltip content="Edit agent details">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => openEdit(agent)}
                          aria-label={`Edit ${agent.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Duplicate agent">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => onDuplicate(agent.id)}
                          aria-label={`Duplicate ${agent.name}`}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </Tooltip>
                      <Tooltip content="Delete agent">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-[var(--red)] hover:text-[var(--red)]"
                          onClick={() => setPendingDeleteId(agent.id)}
                          aria-label={`Delete ${agent.name}`}
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
        title={form?.mode === "edit" ? "Edit Agent" : "Create Agent"}
        description={
          form?.mode === "edit"
            ? "Update how this agent appears in the workspace."
            : "Start with a simple Start-to-End flow and customize it in the builder."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setForm(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} disabled={!name.trim()}>
              {form?.mode === "edit" ? "Save Changes" : "Create Agent"}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <Field label="Agent Name" htmlFor="agent-name">
            <Input
              id="agent-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Wellness Check Agent"
              autoFocus
            />
          </Field>
          <Field label="Description" htmlFor="agent-description">
            <Textarea
              id="agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe the purpose of this agent."
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
        title="Delete this agent?"
        description="The agent and its current Flow draft will be removed from this workspace."
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
              <Trash2 className="h-4 w-4" /> Delete Agent
            </Button>
          </>
        }
      >
        {pendingDelete && (
          <div className="rounded-xl border border-[var(--danger-soft)] bg-[var(--danger-soft)]/55 p-4">
            <p className="text-sm font-bold text-[var(--text)]">{pendingDelete.name}</p>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
              {pendingDelete.nodes.length} blocks and {pendingDelete.edges.length} edges will be deleted.
            </p>
          </div>
        )}
      </Dialog>
    </main>
  );
}

function AgentMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--blue-soft)] text-[var(--blue)]">
        <Bot className="h-6 w-6" />
      </div>
      <h3 className="mt-5 text-base font-extrabold text-[var(--text)]">Create your first voice agent</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        Build a call flow by connecting Start, Node, Tool, and End blocks.
      </p>
      <Button variant="primary" className="mt-6" onClick={onCreate}>
        <Plus className="h-4 w-4" /> Create Agent
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
