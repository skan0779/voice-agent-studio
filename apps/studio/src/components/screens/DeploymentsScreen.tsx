import { Bot, Check, ChevronDown, PhoneCall, RadioTower, RefreshCw, Rocket, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowDocument, PlatformSettings } from "../../domain/flow";
import { formatContactPhoneNumber, type Contact } from "../../domain/workspaces";
import { listDeployments, type DeploymentRecord } from "../../lib/runtimeApi";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";

interface OutboundCallRequest {
  agentId: string;
  toNumber: string;
  contact: Pick<Contact, "id" | "name" | "photoDataUrl">;
}

function ContactAvatar({ contact, size }: { contact: Contact; size: number }) {
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-[var(--border)] bg-[var(--blue-soft)] text-[var(--blue)]"
      style={{ width: size, height: size, minWidth: size, minHeight: size, borderRadius: "50%" }}
    >
      {contact.photoDataUrl ? (
        <img
          src={contact.photoDataUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          style={{ borderRadius: "50%" }}
        />
      ) : (
        <UserRound className={size > 28 ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden="true" />
      )}
    </span>
  );
}

export function DeploymentsScreen({
  agents,
  contacts,
  workspaceId,
  settings,
  onStartCall,
}: {
  agents: FlowDocument[];
  contacts: Contact[];
  workspaceId: string;
  settings: PlatformSettings;
  onStartCall: (request: OutboundCallRequest) => Promise<void>;
}) {
  const [deployments, setDeployments] = useState<DeploymentRecord[]>([]);
  const [loadingDeployments, setLoadingDeployments] = useState(true);
  const [deploymentError, setDeploymentError] = useState<string | null>(null);
  const [callOpen, setCallOpen] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactMenuOpen, setContactMenuOpen] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);
  const contactMenuRef = useRef<HTMLDivElement>(null);

  const loadDeployments = useCallback(async () => {
    setLoadingDeployments(true);
    setDeploymentError(null);
    try {
      setDeployments(await listDeployments(settings, workspaceId));
    } catch (error) {
      setDeployments([]);
      setDeploymentError(error instanceof Error ? error.message : "Could not load deployments.");
    } finally {
      setLoadingDeployments(false);
    }
  }, [settings, workspaceId]);
  useEffect(() => {
    void loadDeployments();
  }, [loadDeployments]);

  const deployedAgentIds = useMemo(() => new Set(deployments.map((deployment) => deployment.agent_id)), [deployments]);
  const deploymentByAgentId = useMemo(
    () => new Map(deployments.map((deployment) => [deployment.agent_id, deployment])),
    [deployments],
  );
  const deployedAgents = useMemo(
    () => agents.filter((agent) => deployedAgentIds.has(agent.id)),
    [agents, deployedAgentIds],
  );
  const callableContacts = useMemo(() => contacts.filter((contact) => contact.phoneNumber.trim()), [contacts]);

  const selectedAgent = deployedAgents.find((agent) => agent.id === agentId) ?? null;
  const selectedContact = callableContacts.find((contact) => contact.id === contactId) ?? null;
  const canStartCall = Boolean(agentId && selectedContact?.phoneNumber.trim());
  const integrationLabel = settings.connections.telephonyIntegration === "sip" ? "SIP" : "Media Streams";

  const openCall = (selectedAgentId: string) => {
    setAgentId(selectedAgentId);
    setContactId(callableContacts[0]?.id ?? "");
    setContactMenuOpen(false);
    setCallError(null);
    setCallOpen(true);
  };

  useEffect(() => {
    if (!contactMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!contactMenuRef.current?.contains(event.target as Node)) setContactMenuOpen(false);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, [contactMenuOpen]);
  const submitCall = async () => {
    if (!canStartCall) return;
    setStartingCall(true);
    setCallError(null);
    try {
      if (!selectedContact) return;
      await onStartCall({
        agentId,
        toNumber: selectedContact.phoneNumber.trim(),
        contact: {
          id: selectedContact.id,
          name: selectedContact.name,
          photoDataUrl: selectedContact.photoDataUrl,
        },
      });
      setCallOpen(false);
    } catch (error) {
      setCallError(error instanceof Error ? error.message : "Could not start the call.");
    } finally {
      setStartingCall(false);
    }
  };

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1180px]">
        <div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">Deployments</h2>
              <Badge>{deployedAgents.length}</Badge>
            </div>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              Select a deployed agent and start an outbound call.
            </p>
          </div>
        </div>

        {deploymentError ? (
          <section className="mt-6 rounded-2xl border border-[var(--red-border)] bg-[var(--surface)] px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--red-soft)] text-[var(--red)]">
              <RadioTower className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">Runtime unavailable</h3>
            <p className="mx-auto mt-1.5 max-w-md text-xs text-[var(--text-muted)]">{deploymentError}</p>
            <Button className="mt-5" variant="secondary" size="sm" onClick={() => void loadDeployments()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </section>
        ) : loadingDeployments ? (
          <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-6 py-20 text-center">
            <RefreshCw className="mx-auto h-6 w-6 animate-spin text-[var(--text-muted)]" />
            <p className="mt-3 text-xs text-[var(--text-muted)]">Loading deployments...</p>
          </section>
        ) : deployedAgents.length === 0 ? (
          <section className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--amber-soft)] text-[var(--amber)]">
              <Rocket className="h-6 w-6" />
            </div>
            <h3 className="mt-4 text-sm font-bold text-[var(--text)]">No deployed agents</h3>
            <p className="mt-1.5 text-xs text-[var(--text-muted)]">
              Deploy an agent from Agent Builder before starting a call.
            </p>
          </section>
        ) : (
          <section
            className="mt-6 grid grid-cols-3 gap-4 max-xl:grid-cols-2 max-md:grid-cols-1"
            aria-label="Deployed agents"
          >
            {deployedAgents.map((agent) => {
              const deployment = deploymentByAgentId.get(agent.id);
              return (
                <article
                  key={agent.id}
                  className="group overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs transition-all hover:-translate-y-0.5 hover:border-[var(--green-border)] hover:shadow-lg"
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--green-soft)] text-[var(--green)]">
                        <Bot className="h-5 w-5" />
                      </div>
                      <Badge tone="green" dot>
                        Deployed
                      </Badge>
                    </div>
                    <h3 className="mt-5 truncate text-base font-extrabold tracking-[-0.02em] text-[var(--text)]">
                      {agent.name}
                    </h3>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--text-muted)]">
                      {agent.description || "No description"}
                    </p>
                    <div className="mt-5 grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-4">
                      <DeploymentMetric label="Blocks" value={agent.nodes.length} />
                      <DeploymentMetric label="Edges" value={agent.edges.length} />
                      <DeploymentMetric label="Connection" value={integrationLabel} />
                    </div>
                    <p className="mt-4 text-[10px] text-[var(--text-muted)]">
                      Deployed {formatDeployedAt(deployment?.created_at)}
                    </p>
                  </div>
                  <div className="flex items-center justify-center border-t border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-3">
                    <Button variant="primary" size="sm" className="min-w-36" onClick={() => openCall(agent.id)}>
                      <PhoneCall className="h-3.5 w-3.5" /> Start Call
                    </Button>
                  </div>
                </article>
              );
            })}
          </section>
        )}
      </div>

      <Dialog
        open={callOpen}
        onOpenChange={(open) => {
          setCallOpen(open);
          if (!open) setContactMenuOpen(false);
        }}
        title="Start Call"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCallOpen(false)} disabled={startingCall}>
              Cancel
            </Button>
            <Button variant="primary" loading={startingCall} onClick={submitCall} disabled={!canStartCall}>
              <PhoneCall className="h-4 w-4" /> Call
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          {selectedAgent && (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--green-soft)] text-[var(--green)]">
                <Bot className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-[var(--text)]">{selectedAgent.name}</p>
                <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{integrationLabel}</p>
              </div>
              <Badge tone="green" dot>
                Ready
              </Badge>
            </div>
          )}
          <Field label="Contact" htmlFor="outbound-contact">
            <div ref={contactMenuRef} className="relative">
              <button
                id="outbound-contact"
                type="button"
                disabled={callableContacts.length === 0}
                aria-haspopup="listbox"
                aria-expanded={contactMenuOpen}
                onClick={() => setContactMenuOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setContactMenuOpen(false);
                }}
                className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-left outline-none transition-shadow hover:bg-[var(--surface-hover)] focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)] disabled:cursor-not-allowed disabled:opacity-55"
              >
                {selectedContact ? (
                  <ContactAvatar contact={selectedContact} size={32} />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--blue-soft)] text-[var(--blue)]">
                    <UserRound className="h-4 w-4" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-bold text-[var(--text)]">
                    {selectedContact?.name ?? "No contacts available"}
                  </span>
                  {selectedContact && (
                    <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--text-muted)]">
                      {formatContactPhoneNumber(selectedContact.phoneNumber)}
                    </span>
                  )}
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${contactMenuOpen ? "rotate-180" : ""}`}
                />
              </button>
              {contactMenuOpen && (
                <div
                  role="listbox"
                  aria-label="Contacts"
                  className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-64 overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-xl"
                >
                  {callableContacts.map((contact) => {
                    const selected = contact.id === contactId;
                    return (
                      <button
                        key={contact.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        onClick={() => {
                          setContactId(contact.id);
                          setContactMenuOpen(false);
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${selected ? "bg-[var(--blue-soft)]" : "hover:bg-[var(--surface-hover)]"}`}
                      >
                        <ContactAvatar contact={contact} size={28} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[10px] font-bold text-[var(--text)]">
                            {contact.name}
                          </span>
                          <span className="block truncate font-mono text-[9px] text-[var(--text-muted)]">
                            {formatContactPhoneNumber(contact.phoneNumber)}
                          </span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-[var(--blue)]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Field>
          {callableContacts.length === 0 && (
            <p className="text-xs text-[var(--text-muted)]">
              Add a contact with a phone number on the Contacts page before starting a call.
            </p>
          )}
          {callError && (
            <div
              className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] px-4 py-3 text-xs font-semibold text-[var(--red)]"
              role="alert"
            >
              {callError}
            </div>
          )}
        </div>
      </Dialog>
    </main>
  );
}

function DeploymentMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-1 truncate text-sm font-extrabold text-[var(--text)]">{value}</p>
    </div>
  );
}

function formatDeployedAt(value?: string) {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    date,
  );
}
