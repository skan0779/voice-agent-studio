import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Headphones,
  LoaderCircle,
  PhoneCall,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { listCallRecords, type RuntimeCallRecord } from "../../lib/runtimeApi";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";

const DAY_MS = 24 * 60 * 60 * 1000;

function statusCopy(status: string) {
  if (status === "completed") return { label: "Completed", tone: "green" as const };
  if (status === "review") return { label: "Review Required", tone: "amber" as const };
  if (["failed", "disconnected", "canceled"].includes(status)) {
    return { label: status === "disconnected" ? "Disconnected" : "Failed", tone: "red" as const };
  }
  if (status === "in-progress") return { label: "Live", tone: "blue" as const };
  return {
    label: status.replaceAll("-", " ").replace(/\b\w/g, (value) => value.toUpperCase()),
    tone: "blue" as const,
  };
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

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function recordDate(call: RuntimeCallRecord) {
  return new Date(call.started_at ?? call.created_at);
}

export function OverviewScreen({
  workspaceId,
  workspaceName,
  agentCount,
  deployedAgentCount,
  onOpenBuilder,
  onOpenCalls,
}: {
  workspaceId: string;
  workspaceName: string;
  agentCount: number;
  deployedAgentCount: number;
  onOpenBuilder: () => void;
  onOpenCalls: () => void;
}) {
  const [calls, setCalls] = useState<RuntimeCallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCalls(await listCallRecords(workspaceId));
    } catch (cause) {
      setCalls([]);
      setError(cause instanceof Error ? cause.message : "Could not load call records.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const dashboard = useMemo(() => {
    const today = startOfDay(new Date());
    const tomorrow = new Date(today.getTime() + DAY_MS);
    const callsToday = calls.filter((call) => {
      const date = recordDate(call);
      return date >= today && date < tomorrow;
    });
    const live = calls.filter((call) => call.status === "in-progress").length;
    const review = calls.filter((call) => call.status === "review").length;
    const terminal = calls.filter((call) =>
      ["completed", "review", "failed", "disconnected", "canceled"].includes(call.status),
    );
    const successful = terminal.filter((call) => ["completed", "review"].includes(call.status)).length;
    const latencyValues = calls.map((call) => call.latency_ms).filter((value): value is number => value !== null);
    const completionRate = terminal.length > 0 ? (successful / terminal.length) * 100 : null;
    const averageLatency =
      latencyValues.length > 0
        ? Math.round(latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length)
        : null;
    const days = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(today.getTime() - (13 - index) * DAY_MS);
      const next = new Date(date.getTime() + DAY_MS);
      return {
        date,
        count: calls.filter((call) => {
          const started = recordDate(call);
          return started >= date && started < next;
        }).length,
      };
    });
    return {
      callsToday,
      completedToday: callsToday.filter((call) => ["completed", "review"].includes(call.status)).length,
      live,
      review,
      completionRate,
      averageLatency,
      days,
      outcomes: {
        completed: calls.filter((call) => call.status === "completed").length,
        review,
        failed: calls.filter((call) => ["failed", "disconnected", "canceled"].includes(call.status)).length,
        live,
      },
    };
  }, [calls]);

  const maxDailyCalls = Math.max(1, ...dashboard.days.map((day) => day.count));
  const metrics = [
    {
      label: "Calls Today",
      value: String(dashboard.callsToday.length),
      detail: `${dashboard.completedToday} completed`,
      icon: PhoneCall,
      tone: "blue",
    },
    {
      label: "Completion Rate",
      value: dashboard.completionRate === null ? "—" : `${dashboard.completionRate.toFixed(1)}%`,
      detail: "All recorded calls",
      icon: CheckCircle2,
      tone: "green",
    },
    {
      label: "Average Response Latency",
      value: dashboard.averageLatency === null ? "—" : `${dashboard.averageLatency}ms`,
      detail: "Measured calls",
      icon: Activity,
      tone: "purple",
    },
    {
      label: "Review Required",
      value: String(dashboard.review),
      detail: dashboard.review === 1 ? "1 call flagged" : `${dashboard.review} calls flagged`,
      icon: ShieldAlert,
      tone: "amber",
    },
  ] as const;

  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1440px]">
        <section className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 px-7 py-7 text-white shadow-xl shadow-slate-950/10">
          <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-blue-600/25 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-1/4 h-28 w-48 bg-cyan-400/10 blur-3xl" />
          <div className="relative flex items-center justify-between gap-8 max-md:flex-col max-md:items-start">
            <div>
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-blue-200">
                <Sparkles className="h-4 w-4" /> Voice Agent Studio
              </div>
              <h2 className="text-2xl font-extrabold tracking-[-0.035em]">{workspaceName} Overview</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">
                {loading
                  ? "Loading the latest call activity."
                  : error
                    ? "Call activity is temporarily unavailable. Your workspace configuration is still accessible."
                    : calls.length === 0
                      ? "No calls have been recorded yet. Deploy an agent and start a call when you are ready."
                      : `${dashboard.completedToday} calls completed today${dashboard.live > 0 ? `, with ${dashboard.live} currently live` : ""}.`}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={onOpenBuilder}
                  className="border-blue-500 bg-blue-600 hover:bg-blue-500"
                >
                  Open Agent Builder <ArrowRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={onOpenCalls}
                  className="border-slate-700 bg-slate-900 text-white hover:bg-slate-800"
                >
                  <Headphones className="h-4 w-4" /> View Call Records
                </Button>
              </div>
            </div>
            <div className="grid w-[360px] shrink-0 grid-cols-2 gap-3 max-md:w-full">
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <span
                    className={`h-2 w-2 rounded-full ${dashboard.live > 0 ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`}
                  />{" "}
                  LIVE NOW
                </div>
                <p className="mt-3 text-xl font-bold tabular-nums">{loading ? "—" : dashboard.live}</p>
                <p className="mt-1 text-[10px] text-slate-400">Active calls</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
                <div className="flex items-center gap-2 text-[10px] text-slate-400">
                  <CheckCircle2 className="h-3 w-3" /> DEPLOYED
                </div>
                <p className="mt-3 text-xl font-bold tabular-nums">{deployedAgentCount}</p>
                <p className="mt-1 text-[10px] text-slate-400">of {agentCount} agents</p>
              </div>
            </div>
          </div>
        </section>

        {error && (
          <section
            className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[var(--red-border)] bg-[var(--red-soft)] px-5 py-4"
            role="alert"
          >
            <div>
              <p className="text-xs font-bold text-[var(--red)]">Call records unavailable</p>
              <p className="mt-1 text-[10px] text-[var(--text-secondary)]">{error}</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Try Again
            </Button>
          </section>
        )}

        <section
          className="mt-5 grid grid-cols-4 gap-4 max-xl:grid-cols-2 max-sm:grid-cols-1"
          aria-label="Call metrics"
        >
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article
                key={metric.label}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs"
              >
                <div className="flex items-start justify-between">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl metric-${metric.tone}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {loading && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-[var(--text-muted)]" />}
                </div>
                <p className="mt-4 text-2xl font-extrabold tracking-[-0.04em] text-[var(--text)] tabular-nums">
                  {loading ? "—" : metric.value}
                </p>
                <p className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">{metric.label}</p>
                <p className="mt-2 text-[9px] text-[var(--text-muted)]">{metric.detail}</p>
              </article>
            );
          })}
        </section>

        <section className="mt-5 grid grid-cols-[1.35fr_0.65fr] gap-5 max-xl:grid-cols-1">
          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-[var(--text)]">Call Activity</h3>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">Calls started over the last 14 days</p>
              </div>
              <Badge tone="blue">{dashboard.days.reduce((sum, day) => sum + day.count, 0)} calls</Badge>
            </div>
            <div className="mt-6 flex h-40 items-end gap-2 border-b border-[var(--border)] px-1">
              {dashboard.days.map((day) => (
                <div key={day.date.toISOString()} className="group relative flex h-full flex-1 items-end">
                  <div
                    className="w-full min-w-1 rounded-t-sm bg-blue-500/80 transition-colors hover:bg-blue-500"
                    style={{ height: day.count === 0 ? "2px" : `${Math.max(8, (day.count / maxDailyCalls) * 100)}%` }}
                  />
                  <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[8px] text-white shadow-lg group-hover:block">
                    {day.count} {day.count === 1 ? "call" : "calls"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between text-[9px] text-[var(--text-muted)]">
              <span>{dashboard.days[0]?.date.toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
              <span>Today</span>
            </div>
          </article>

          <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">Call Outcomes</h3>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">Current workspace history</p>
            </div>
            <div className="mt-5 space-y-1">
              {[
                ["Completed", dashboard.outcomes.completed, "bg-[var(--green)]", "green"],
                ["Review Required", dashboard.outcomes.review, "bg-[var(--amber)]", "amber"],
                ["Failed or Disconnected", dashboard.outcomes.failed, "bg-[var(--red)]", "red"],
                ["Live", dashboard.outcomes.live, "bg-[var(--blue)]", "blue"],
              ].map(([label, count, dot, tone]) => (
                <div
                  key={String(label)}
                  className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-[var(--surface-hover)]"
                >
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  <span className="min-w-0 flex-1 text-[10px] font-bold text-[var(--text)]">{label}</span>
                  <Badge tone={tone as "green" | "amber" | "red" | "blue"}>{loading ? "—" : count}</Badge>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="mt-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">Recent Calls</h3>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">The latest runtime call records.</p>
            </div>
            <Button variant="ghost" size="sm" onClick={onOpenCalls}>
              View All <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 px-6 py-12 text-xs text-[var(--text-muted)]">
              <LoaderCircle className="h-4 w-4 animate-spin" /> Loading recent calls
            </div>
          ) : calls.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Headphones className="mx-auto h-6 w-6 text-[var(--text-muted)]" />
              <p className="mt-3 text-xs font-bold text-[var(--text)]">No recent calls</p>
              <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                Calls started from Deployments will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left">
                <thead>
                  <tr className="bg-[var(--surface-subtle)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-4 py-3">Recipient</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Started</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {calls.slice(0, 5).map((call) => {
                    const status = statusCopy(call.status);
                    return (
                      <tr
                        key={call.id}
                        className="cursor-pointer outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--blue-soft)]"
                        tabIndex={0}
                        onClick={onOpenCalls}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") onOpenCalls();
                        }}
                      >
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-muted)]">
                              <Headphones className="h-3.5 w-3.5" />
                            </div>
                            <div>
                              <p className="text-[11px] font-bold text-[var(--text)]">{call.agent_name}</p>
                              <p className="mt-0.5 max-w-40 truncate font-mono text-[8px] text-[var(--text-muted)]">
                                {call.call_sid ?? call.id}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {call.to_number}
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge tone={status.tone} dot>
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-[10px] text-[var(--text-secondary)]">
                          {formatDate(call.started_at ?? call.created_at)}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {formatDuration(call.duration_ms)}
                        </td>
                        <td className="px-4 py-3.5 font-mono text-[10px] text-[var(--text-secondary)]">
                          {call.latency_ms === null ? "—" : `${call.latency_ms}ms`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
