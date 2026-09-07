import {
  Braces,
  ChevronRight,
  FileText,
  Headphones,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatContactPhoneNumber, type Contact } from "../../domain/workspaces";
import { cn } from "../../lib/cn";
import { deleteCallRecord, getCallArtifact, listCallRecords, type RuntimeCallRecord } from "../../lib/runtimeApi";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Input } from "../ui/Field";

function statusCopy(status: string) {
  if (status === "completed") return { label: "Completed", tone: "green" as const };
  if (status === "review") return { label: "Review Required", tone: "amber" as const };
  if (["failed", "disconnected", "canceled"].includes(status)) {
    return {
      label: status === "disconnected" ? "Disconnected" : "Failed",
      tone: "red" as const,
    };
  }
  if (status === "in-progress") return { label: "Live", tone: "blue" as const };
  return {
    label: status.replaceAll("-", " ").replace(/\b\w/g, (value) => value.toUpperCase()),
    tone: "blue" as const,
  };
}

function reviewCopy(review: RuntimeCallRecord["review"]) {
  if (review === "safety") return { label: "Safety", tone: "red" as const };
  if (review === "declined") return { label: "Declined", tone: "neutral" as const };
  if (review === "incomplete") return { label: "Incomplete", tone: "amber" as const };
  return null;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDuration(durationMs: number | null) {
  if (durationMs === null) return "—";
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function comparablePhoneNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
}

function resolveCallContact(call: RuntimeCallRecord, contacts: Contact[]) {
  const current =
    contacts.find((contact) => contact.id === call.contact_id) ??
    contacts.find((contact) => comparablePhoneNumber(contact.phoneNumber) === comparablePhoneNumber(call.to_number));
  return {
    name: call.contact_name || current?.name || "Unknown Contact",
    phoneNumber: formatContactPhoneNumber(current?.phoneNumber || call.to_number),
    photoDataUrl: call.contact_photo_data_url || current?.photoDataUrl || "",
  };
}

function ContactAvatar({ name, photoDataUrl }: { name: string; photoDataUrl: string }) {
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--blue-soft)] text-[var(--blue)]">
      {photoDataUrl ? (
        <img src={photoDataUrl} alt="" className="absolute inset-0 h-full w-full rounded-full object-cover" />
      ) : (
        <UserRound className="h-4 w-4" aria-label={`${name} profile`} />
      )}
    </span>
  );
}

function downloadJson(payload: Record<string, unknown>, fileName: string) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CallsScreen({
  workspaceId,
  contacts,
  onCountChange,
}: {
  workspaceId: string;
  contacts: Contact[];
  onCountChange?: (count: number) => void;
}) {
  const [calls, setCalls] = useState<RuntimeCallRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await listCallRecords(workspaceId);
      setCalls(records);
      setSelectedId((current) => (records.some((call) => call.id === current) ? current : (records[0]?.id ?? "")));
      onCountChange?.(records.length);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load call records.");
      setCalls([]);
      setSelectedId("");
      onCountChange?.(0);
    } finally {
      setLoading(false);
    }
  }, [onCountChange, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return calls;
    return calls.filter((call) => {
      const contact = resolveCallContact(call, contacts);
      return `${contact.name} ${contact.phoneNumber} ${call.agent_name} ${call.to_number} ${call.call_sid ?? ""} ${call.id}`
        .toLowerCase()
        .includes(normalized);
    });
  }, [calls, contacts, query]);
  const selected = calls.find((call) => call.id === selectedId) ?? calls[0];
  const pendingDelete = calls.find((call) => call.id === pendingDeleteId) ?? null;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCallRecord(pendingDelete.id);
      const nextCalls = calls.filter((call) => call.id !== pendingDelete.id);
      setCalls(nextCalls);
      setSelectedId((current) => (current === pendingDelete.id ? (nextCalls[0]?.id ?? "") : current));
      onCountChange?.(nextCalls.length);
      setPendingDeleteId(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "Could not delete this call record.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main id="main-content" className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <div className="relative w-80 max-sm:w-full">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Contact, agent, phone number, or Call SID"
            className="pl-9 text-xs"
            aria-label="Search calls"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto p-5" aria-label="Call list">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--text)]">
              All Calls <span className="text-[var(--text-muted)]">{calls.length}</span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Runtime history</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-16 text-xs text-[var(--text-muted)]">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading call records
              </div>
            ) : error ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm font-bold text-[var(--text)]">Runtime unavailable</p>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">{error}</p>
              </div>
            ) : calls.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <Headphones className="mx-auto h-7 w-7 text-[var(--text-muted)]" />
                <p className="mt-4 text-sm font-bold text-[var(--text)]">No call records</p>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  Calls started from Deployments will appear here.
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[1040px] text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-3 py-3">Agent</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3">Review</th>
                    <th className="px-3 py-3">Duration</th>
                    <th className="px-3 py-3">Turns</th>
                    <th className="px-3 py-3">Latency</th>
                    <th className="px-3 py-3">Started</th>
                    <th className="w-16" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filtered.map((call) => {
                    const status = statusCopy(call.status);
                    const review = reviewCopy(call.review);
                    const contact = resolveCallContact(call, contacts);
                    return (
                      <tr
                        key={call.id}
                        onClick={() => setSelectedId(call.id)}
                        className={cn(
                          "cursor-pointer outline-none transition-colors hover:bg-[var(--surface-hover)]",
                          selected?.id === call.id && "bg-[var(--blue-soft)]",
                        )}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setSelectedId(call.id);
                        }}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <ContactAvatar name={contact.name} photoDataUrl={contact.photoDataUrl} />
                            <div className="min-w-0">
                              <p className="max-w-40 truncate text-[11px] font-bold text-[var(--text)]">
                                {contact.name}
                              </p>
                              <p className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">
                                {contact.phoneNumber}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5">
                          <p
                            className="max-w-36 truncate text-[10px] font-semibold text-[var(--text-secondary)]"
                            title={call.agent_name}
                          >
                            {call.agent_name}
                          </p>
                        </td>
                        <td className="px-3 py-3.5">
                          <Badge tone={status.tone} dot>
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3.5">
                          {review ? (
                            <Badge tone={review.tone} dot>
                              {review.label}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {formatDuration(call.duration_ms)}
                        </td>
                        <td className="px-3 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">{call.turns}</td>
                        <td className="px-3 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {call.latency_ms === null ? "—" : `${call.latency_ms}ms`}
                        </td>
                        <td className="px-3 py-3.5 text-[10px] text-[var(--text-secondary)]">
                          {formatDate(call.started_at ?? call.created_at)}
                        </td>
                        <td className="pr-2">
                          <div className="flex items-center justify-end gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-[var(--text-muted)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"
                              aria-label={`Delete call to ${call.to_number}`}
                              title="Delete call record"
                              onClick={(event) => {
                                event.stopPropagation();
                                setDeleteError(null);
                                setPendingDeleteId(call.id);
                              }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {selected && <CallDetail call={selected} />}
      </div>
      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDeleteId(null);
        }}
        title="Delete this call record?"
        description={pendingDelete ? `The call to ${pendingDelete.to_number} will be permanently removed.` : undefined}
        footer={
          <>
            <Button variant="secondary" disabled={deleting} onClick={() => setPendingDeleteId(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              <Trash2 className="h-4 w-4" /> Delete Call
            </Button>
          </>
        }
      >
        <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-xs leading-5 text-[var(--red)]">
          This also deletes the saved transcript, final state, execution path, and runtime trace. This action cannot be
          undone.
        </div>
        {deleteError && (
          <p role="alert" className="mt-3 text-xs font-semibold text-[var(--red)]">
            {deleteError}
          </p>
        )}
      </Dialog>
    </main>
  );
}

function CallDetail({ call }: { call: RuntimeCallRecord }) {
  const [downloading, setDownloading] = useState<"transcript" | "state" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const status = statusCopy(call.status);
  const review = reviewCopy(call.review);

  const download = async (artifact: "transcript" | "state") => {
    setDownloading(artifact);
    setDownloadError(null);
    try {
      const payload = await getCallArtifact(call.id, artifact);
      downloadJson(payload, `${call.call_sid ?? call.id}-${artifact}.json`);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : `Could not download ${artifact}.`);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <aside
      className="w-[372px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] max-xl:hidden"
      aria-label="Selected call details"
    >
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          {review && (
            <Badge tone={review.tone} dot>
              {review.label}
            </Badge>
          )}
        </div>
        <h2 className="mt-3 text-base font-bold text-[var(--text)]">{call.agent_name}</h2>
        <p className="mt-1 font-mono text-[10px] text-[var(--text-muted)]">{call.call_sid ?? call.id}</p>
        <p className="mt-2 font-mono text-[11px] text-[var(--text-secondary)]">
          {call.from_number} → {call.to_number}
        </p>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-[var(--surface-subtle)] p-3">
            <p className="text-[9px] text-[var(--text-muted)]">Duration</p>
            <p className="mt-1 font-mono text-[11px] font-bold text-[var(--text)]">
              {formatDuration(call.duration_ms)}
            </p>
          </div>
          <div className="rounded-xl bg-[var(--surface-subtle)] p-3">
            <p className="text-[9px] text-[var(--text-muted)]">Turns</p>
            <p className="mt-1 font-mono text-[11px] font-bold text-[var(--text)]">{call.turns}</p>
          </div>
          <div className="rounded-xl bg-[var(--surface-subtle)] p-3">
            <p className="text-[9px] text-[var(--text-muted)]">Latency</p>
            <p className="mt-1 font-mono text-[11px] font-bold text-[var(--text)]">
              {call.latency_ms === null ? "—" : `${call.latency_ms}ms`}
            </p>
          </div>
        </div>
      </div>
      {review && (
        <div
          className={cn(
            "m-4 rounded-xl border p-3.5",
            review.tone === "red"
              ? "border-[var(--red-border)] bg-[var(--red-soft)]"
              : "border-[var(--amber-border)] bg-[var(--amber-soft)]",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-2 text-[11px] font-bold",
              review.tone === "red" ? "text-[var(--red)]" : "text-[var(--amber)]",
            )}
          >
            <ShieldAlert className="h-4 w-4" /> {review.label}
          </div>
          <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-secondary)]">
            {call.review === "safety"
              ? "A safety signal was present in the final runtime state."
              : call.review === "declined"
                ? "The contact declined consent and the call ended without screening."
                : "The call ended before the assessment flow was completed."}
          </p>
        </div>
      )}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-[var(--text)]">Execution Path</h3>
          <Badge>{call.path.length} nodes</Badge>
        </div>
        {call.path.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {call.path.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="flex items-center gap-1.5 text-[9px] font-semibold text-[var(--text-secondary)]"
              >
                <span className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-1.5">
                  {item}
                </span>
                {index < call.path.length - 1 && <ChevronRight className="h-3 w-3 text-[var(--text-muted)]" />}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-[10px] text-[var(--text-muted)]">Execution path was not captured for this call.</p>
        )}
      </div>
      <div className="border-t border-[var(--border)] p-4">
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="secondary"
            disabled={!call.has_transcript || downloading !== null}
            loading={downloading === "transcript"}
            onClick={() => void download("transcript")}
          >
            <FileText className="h-4 w-4" /> Transcript
          </Button>
          <Button
            variant="secondary"
            disabled={!call.has_state || downloading !== null}
            loading={downloading === "state"}
            onClick={() => void download("state")}
          >
            <Braces className="h-4 w-4" /> State
          </Button>
        </div>
        {downloadError && (
          <p role="alert" className="mt-2 text-center text-[9px] leading-4 text-[var(--red)]">
            {downloadError}
          </p>
        )}
        {(!call.has_transcript || !call.has_state) && (
          <p className="mt-2 text-center text-[9px] leading-4 text-[var(--text-muted)]">
            Artifacts are available for calls completed after this update.
          </p>
        )}
      </div>
    </aside>
  );
}
