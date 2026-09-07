import { Activity, Bot, CircleAlert, Clock3, Headphones, Radio, RefreshCw, UserRound, Wrench } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatContactPhoneNumber, type Contact } from "../../domain/workspaces";
import { cn } from "../../lib/cn";
import {
  listCallRecords,
  subscribeToLiveEvents,
  type RuntimeCallRecord,
  type RuntimeLiveEvent,
} from "../../lib/runtimeApi";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

type ConnectionStatus = "connecting" | "connected" | "offline";
type MessageStatus = "streaming" | "complete" | "interrupted" | "listening";

interface LiveMessage {
  id: string;
  speaker: "assistant" | "user";
  text: string;
  status: MessageStatus;
  sequence: number;
}

interface LiveActivity {
  id: string;
  kind: "node" | "tool" | "system" | "error";
  title: string;
  detail?: string;
  sequence: number;
}

interface LiveSession {
  callId: string;
  startedAt: number | null;
  endedAt: number | null;
  currentNode: string;
  state: Record<string, unknown> | null;
  messages: LiveMessage[];
  activities: LiveActivity[];
}

const ACTIVE_STATUSES = new Set(["preparing", "queued", "initiated", "ringing", "in-progress"]);

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function upsertMessage(messages: LiveMessage[], message: LiveMessage) {
  const index = messages.findIndex((candidate) => candidate.id === message.id);
  if (index < 0) return [...messages, message];
  const next = [...messages];
  next[index] = { ...next[index], ...message };
  return next;
}

function appendActivity(activities: LiveActivity[], activity: LiveActivity) {
  return [...activities, activity].slice(-30);
}

function applyLiveEvent(current: Record<string, LiveSession>, liveEvent: RuntimeLiveEvent) {
  const callId = liveEvent.data.runtime_call_id;
  if (!callId) return current;
  const existing = current[callId] ?? {
    callId,
    startedAt: null,
    endedAt: null,
    currentNode: "Waiting for call audio",
    state: null,
    messages: [],
    activities: [],
  };
  const session: LiveSession = { ...existing };
  const itemId = asString(liveEvent.data.item_id) || `${liveEvent.event}-${liveEvent.sequence}`;

  if (liveEvent.event === "time_start") {
    session.startedAt = Number(liveEvent.data.time) || Date.now();
    session.endedAt = null;
  } else if (liveEvent.event === "time_end") {
    session.endedAt = Number(liveEvent.data.time) || Date.now();
  } else if (liveEvent.event === "call_ended") {
    session.endedAt = Date.now();
    session.state = asRecord(liveEvent.data.state) ?? session.state;
  } else if (liveEvent.event === "text_delta") {
    const previous = session.messages.find((message) => message.id === `assistant-${itemId}`);
    session.messages = upsertMessage(session.messages, {
      id: `assistant-${itemId}`,
      speaker: "assistant",
      text: `${previous?.text ?? ""}${asString(liveEvent.data.delta)}`,
      status: "streaming",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "text_done") {
    session.messages = upsertMessage(session.messages, {
      id: `assistant-${itemId}`,
      speaker: "assistant",
      text: asString(liveEvent.data.text),
      status: "complete",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "assistant_interrupted") {
    session.messages = session.messages.map((message) =>
      message.id === `assistant-${itemId}` ? { ...message, status: "interrupted" } : message,
    );
  } else if (liveEvent.event === "user_turn_started") {
    session.messages = upsertMessage(session.messages, {
      id: `user-${itemId}`,
      speaker: "user",
      text: "Listening…",
      status: "listening",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "transcription") {
    session.messages = upsertMessage(session.messages, {
      id: `user-${itemId}`,
      speaker: "user",
      text: asString(liveEvent.data.text) || "Transcription unavailable",
      status: "complete",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "transcription_failed") {
    session.messages = upsertMessage(session.messages, {
      id: `user-${itemId}`,
      speaker: "user",
      text: "Transcription unavailable",
      status: "interrupted",
      sequence: liveEvent.sequence,
    });
  }

  if (liveEvent.event === "flow_started") {
    session.state = asRecord(liveEvent.data.state) ?? session.state;
  } else if (liveEvent.event === "node_entered") {
    session.currentNode = asString(liveEvent.data.node_name) || asString(liveEvent.data.node_id) || "Active node";
    session.state = asRecord(liveEvent.data.state) ?? session.state;
    session.activities = appendActivity(session.activities, {
      id: `node-${liveEvent.sequence}`,
      kind: "node",
      title: session.currentNode,
      detail: "Node entered",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "tool_call") {
    session.activities = appendActivity(session.activities, {
      id: `tool-${liveEvent.sequence}`,
      kind: "tool",
      title: asString(liveEvent.data.tool) || "Tool call",
      detail: "Tool called",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "tool_result") {
    session.state = asRecord(liveEvent.data.state) ?? session.state;
    session.activities = appendActivity(session.activities, {
      id: `result-${liveEvent.sequence}`,
      kind: "system",
      title: asString(liveEvent.data.tool) || "Tool result",
      detail: "State updated",
      sequence: liveEvent.sequence,
    });
  } else if (liveEvent.event === "error" || liveEvent.event === "cleanup_error") {
    session.activities = appendActivity(session.activities, {
      id: `error-${liveEvent.sequence}`,
      kind: "error",
      title: "Runtime error",
      detail: asString(liveEvent.data.message),
      sequence: liveEvent.sequence,
    });
  }

  return { ...current, [callId]: session };
}

function resolveContact(call: RuntimeCallRecord, contacts: Contact[]) {
  const normalize = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.startsWith("82") ? `0${digits.slice(2)}` : digits;
  };
  const contact =
    contacts.find((candidate) => candidate.id === call.contact_id) ??
    contacts.find((candidate) => normalize(candidate.phoneNumber) === normalize(call.to_number));
  return {
    name: call.contact_name || contact?.name || "Unknown Contact",
    phone: formatContactPhoneNumber(contact?.phoneNumber || call.to_number),
    photo: call.contact_photo_data_url || contact?.photoDataUrl || "",
  };
}

function formatElapsed(startedAt: number | null, endedAt: number | null, now: number) {
  if (!startedAt) return "00:00";
  const seconds = Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function CallLiveScreen({
  workspaceId,
  contacts,
  onLiveCountChange,
}: {
  workspaceId: string;
  contacts: Contact[];
  onLiveCountChange?: (count: number) => void;
}) {
  const [calls, setCalls] = useState<RuntimeCallRecord[]>([]);
  const [sessions, setSessions] = useState<Record<string, LiveSession>>({});
  const [selectedId, setSelectedId] = useState("");
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const timelineRef = useRef<HTMLDivElement>(null);

  const loadCalls = useCallback(
    async (showLoading = false) => {
      if (showLoading) setLoading(true);
      try {
        const records = await listCallRecords(workspaceId);
        const liveCalls = records.filter((call) => ACTIVE_STATUSES.has(call.status));
        setCalls(liveCalls);
        setSelectedId((current) =>
          liveCalls.some((call) => call.id === current) ? current : (liveCalls[0]?.id ?? ""),
        );
        onLiveCountChange?.(liveCalls.length);
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not load live calls.");
        setCalls([]);
        onLiveCountChange?.(0);
      } finally {
        setLoading(false);
      }
    },
    [onLiveCountChange, workspaceId],
  );

  useEffect(() => {
    void loadCalls(true);
  }, [loadCalls]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadCalls(false);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loadCalls]);

  useEffect(() => {
    setConnection("connecting");
    return subscribeToLiveEvents(workspaceId, {
      onOpen: () => setConnection("connected"),
      onError: () => setConnection("offline"),
      onEvent: (event) => {
        setSessions((current) => applyLiveEvent(current, event));
        if (["time_start", "time_end", "call_ended"].includes(event.event)) void loadCalls(false);
      },
    });
  }, [loadCalls, workspaceId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const selectedCall = calls.find((call) => call.id === selectedId) ?? calls[0] ?? null;
  const selectedSession = selectedCall ? (sessions[selectedCall.id] ?? null) : null;
  const selectedContact = selectedCall ? resolveContact(selectedCall, contacts) : null;

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight, behavior: "smooth" });
  }, [selectedSession?.messages]);

  return (
    <main id="main-content" className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)]">
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
        <div className="flex items-center gap-3">
          <Badge tone={connection === "connected" ? "green" : connection === "offline" ? "red" : "amber"} dot>
            {connection === "connected"
              ? "Runtime connected"
              : connection === "offline"
                ? "Reconnecting"
                : "Connecting"}
          </Badge>
          <span className="text-[10px] text-[var(--text-muted)]">Live transcript and runtime activity</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void loadCalls(true)} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          className="w-[284px] shrink-0 overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)] p-4"
          aria-label="Live calls"
        >
          <div className="flex items-center justify-between px-1 pb-3">
            <h2 className="text-xs font-bold text-[var(--text)]">Live Calls</h2>
            <Badge tone={calls.length > 0 ? "green" : "neutral"}>{calls.length}</Badge>
          </div>
          {loading && calls.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-[var(--text-muted)]">
              <RefreshCw className="h-4 w-4 animate-spin" /> Loading
            </div>
          ) : error ? (
            <div className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] p-4 text-center">
              <CircleAlert className="mx-auto h-5 w-5 text-[var(--red)]" />
              <p className="mt-2 text-[10px] leading-4 text-[var(--red)]">{error}</p>
            </div>
          ) : calls.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface-subtle)] px-4 py-12 text-center">
              <Radio className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
              <p className="mt-3 text-xs font-bold text-[var(--text)]">No active calls</p>
              <p className="mt-1 text-[10px] leading-4 text-[var(--text-muted)]">
                Start a call from Deployments to monitor it here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {calls.map((call) => {
                const contact = resolveContact(call, contacts);
                const session = sessions[call.id];
                return (
                  <button
                    key={call.id}
                    type="button"
                    onClick={() => setSelectedId(call.id)}
                    className={cn(
                      "w-full rounded-xl border p-3 text-left outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                      selectedCall?.id === call.id
                        ? "border-[var(--blue-border)] bg-[var(--blue-soft)]"
                        : "border-[var(--border)] bg-[var(--surface)]",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--blue)]">
                        {contact.photo ? (
                          <img src={contact.photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
                        ) : (
                          <UserRound className="h-4 w-4" />
                        )}
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)] bg-emerald-500" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-bold text-[var(--text)]">{contact.name}</span>
                        <span className="mt-0.5 block truncate font-mono text-[9px] text-[var(--text-muted)]">
                          {contact.phone}
                        </span>
                      </span>
                      <span className="font-mono text-[9px] font-semibold tabular-nums text-[var(--green)]">
                        {formatElapsed(
                          session?.startedAt ?? (call.started_at ? new Date(call.started_at).getTime() : null),
                          session?.endedAt ?? null,
                          now,
                        )}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                      <span className="max-w-36 truncate text-[9px] text-[var(--text-muted)]">{call.agent_name}</span>
                      <span className="flex items-center gap-1 text-[9px] font-semibold text-[var(--green)]">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> Live
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className="flex min-w-0 flex-1 flex-col" aria-label="Live conversation">
          {selectedCall && selectedContact ? (
            <>
              <div className="flex h-[74px] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-extrabold text-[var(--text)]">{selectedContact.name}</h2>
                    <Badge tone="green" dot>
                      Live
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[10px] text-[var(--text-muted)]">
                    {selectedCall.agent_name} · {selectedContact.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-subtle)] px-3 py-2 font-mono text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
                  <Clock3 className="h-3.5 w-3.5" />{" "}
                  {formatElapsed(
                    selectedSession?.startedAt ??
                      (selectedCall.started_at ? new Date(selectedCall.started_at).getTime() : null),
                    selectedSession?.endedAt ?? null,
                    now,
                  )}
                </div>
              </div>
              <div ref={timelineRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-7">
                {!selectedSession || selectedSession.messages.length === 0 ? (
                  <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--green-border)] bg-[var(--green-soft)] text-[var(--green)]">
                      <Headphones className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-sm font-bold text-[var(--text)]">Waiting for conversation</h3>
                    <p className="mt-1.5 max-w-sm text-xs leading-5 text-[var(--text-muted)]">
                      The transcript will appear as soon as the agent or contact speaks.
                    </p>
                  </div>
                ) : (
                  <div className="mx-auto max-w-3xl space-y-5">
                    {selectedSession.messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn("flex gap-3", message.speaker === "user" && "flex-row-reverse")}
                      >
                        <span
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                            message.speaker === "assistant"
                              ? "bg-[var(--purple-soft)] text-[var(--purple)]"
                              : "bg-[var(--blue-soft)] text-[var(--blue)]",
                          )}
                        >
                          {message.speaker === "assistant" ? (
                            <Bot className="h-4 w-4" />
                          ) : (
                            <UserRound className="h-4 w-4" />
                          )}
                        </span>
                        <div className={cn("max-w-[72%]", message.speaker === "user" && "text-right")}>
                          <p className="mb-1.5 px-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                            {message.speaker === "assistant" ? "Agent" : selectedContact.name}
                          </p>
                          <div
                            className={cn(
                              "rounded-2xl border px-4 py-3 text-left text-[13px] leading-6 shadow-xs",
                              message.speaker === "assistant"
                                ? "rounded-tl-md border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                                : "rounded-tr-md border-[var(--blue-border)] bg-[var(--blue-soft)] text-[var(--text)]",
                              message.status === "interrupted" && "opacity-60",
                            )}
                          >
                            {message.text}
                            {message.status === "streaming" && (
                              <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded-full bg-[var(--blue)] align-middle" />
                            )}
                          </div>
                          {message.status === "interrupted" && (
                            <p className="mt-1 px-1 text-[9px] text-[var(--amber)]">Interrupted</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-xs">
                <Radio className="h-7 w-7" />
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[var(--app-bg)] bg-[var(--text-muted)]" />
              </div>
              <h2 className="mt-5 text-base font-extrabold text-[var(--text)]">Live call monitoring</h2>
              <p className="mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">
                Active calls, live transcripts, node transitions, and Tool activity will appear here.
              </p>
            </div>
          )}
        </section>

        {selectedCall && (
          <aside
            className="w-[326px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] p-5 max-xl:hidden"
            aria-label="Live runtime context"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-bold text-[var(--text)]">Runtime</h2>
              <Badge tone="green" dot>
                Streaming
              </Badge>
            </div>
            <div className="mt-5 rounded-xl border border-[var(--purple-border)] bg-[var(--purple-soft)] p-4">
              <p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--purple)]">Current Node</p>
              <p className="mt-2 text-xs font-extrabold text-[var(--text)]">
                {selectedSession?.currentNode ?? "Connecting"}
              </p>
            </div>
            <div className="mt-6 flex items-center justify-between">
              <h3 className="text-xs font-bold text-[var(--text)]">Activity</h3>
              <span className="text-[9px] text-[var(--text-muted)]">Newest first</span>
            </div>
            <div className="mt-3 space-y-1">
              {(selectedSession?.activities ?? [])
                .slice()
                .reverse()
                .slice(0, 10)
                .map((item) => (
                  <div key={item.id} className="flex gap-3 border-b border-[var(--border)] py-3 last:border-0">
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                        item.kind === "tool"
                          ? "bg-[var(--green-soft)] text-[var(--green)]"
                          : item.kind === "error"
                            ? "bg-[var(--red-soft)] text-[var(--red)]"
                            : item.kind === "node"
                              ? "bg-[var(--purple-soft)] text-[var(--purple)]"
                              : "bg-[var(--blue-soft)] text-[var(--blue)]",
                      )}
                    >
                      {item.kind === "tool" ? (
                        <Wrench className="h-3.5 w-3.5" />
                      ) : item.kind === "error" ? (
                        <CircleAlert className="h-3.5 w-3.5" />
                      ) : (
                        <Activity className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[10px] font-bold text-[var(--text)]">{item.title}</span>
                      {item.detail && (
                        <span className="mt-0.5 block truncate text-[9px] text-[var(--text-muted)]">{item.detail}</span>
                      )}
                    </span>
                  </div>
                ))}
              {(selectedSession?.activities.length ?? 0) === 0 && (
                <p className="py-6 text-center text-[10px] text-[var(--text-muted)]">
                  Runtime activity will appear here.
                </p>
              )}
            </div>
            <div className="mt-6 border-t border-[var(--border)] pt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-[var(--text)]">State Snapshot</h3>
                <span className="text-[9px] text-[var(--text-muted)]">Live</span>
              </div>
              <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-[var(--console)] p-3 font-mono text-[9px] leading-4 text-[var(--console-text)]">
                {selectedSession?.state ? JSON.stringify(selectedSession.state, null, 2) : "Waiting for state…"}
              </pre>
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
