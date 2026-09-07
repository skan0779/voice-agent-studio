import {
  Activity,
  BrainCircuit,
  Download,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  Search,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatContactPhoneNumber, type Contact } from "../../domain/workspaces";
import { cn } from "../../lib/cn";
import {
  analyzeCall,
  analyzePendingReports,
  getReport,
  listReports,
  type AssessmentResult,
  type ReportListItem,
  type ResearchReportEvent,
  type ResearchReport,
} from "../../lib/runtimeApi";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function priorityCopy(priority: ReportListItem["priority"]) {
  if (priority === "review") return { label: "Review", tone: "red" as const };
  if (priority === "monitor") return { label: "Monitor", tone: "amber" as const };
  return { label: "Low", tone: "green" as const };
}

function statusCopy(status: ReportListItem["status"]) {
  if (status === "completed") return { label: "Ready", tone: "green" as const };
  if (status === "failed") return { label: "Failed", tone: "red" as const };
  if (status === "queued" || status === "running") return { label: "Analyzing", tone: "blue" as const };
  return { label: "Not Analyzed", tone: "neutral" as const };
}

function reportAvatar(item: ReportListItem, contacts: Contact[]) {
  const contact = contacts.find((candidate) => candidate.id === item.contact_id);
  return {
    name: contact?.name || item.contact_name,
    photo: contact?.photoDataUrl || item.contact_photo_data_url || "",
    phone: formatContactPhoneNumber(contact?.phoneNumber || item.to_number),
  };
}

function Avatar({ name, photo }: { name: string; photo: string }) {
  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--purple-soft)] text-[var(--purple)]">
      {photo ? (
        <img src={photo} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <UserRound className="h-4 w-4" aria-label={`${name} profile`} />
      )}
    </span>
  );
}

function scoreTone(item: AssessmentResult) {
  if (["severe_depression", "severe_anxiety", "moderately_severe_depression"].includes(item.classification))
    return "bg-[var(--red)]";
  if (
    ["further_assessment_needed", "moderate_depression", "moderate_anxiety", "social_isolation_risk"].includes(
      item.classification,
    )
  )
    return "bg-[var(--amber)]";
  return "bg-[var(--green)]";
}

function downloadReport(report: ResearchReport) {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${report.call_sid ?? report.call_id}-report.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ReportsScreen({
  workspaceId,
  contacts,
  reportEvent,
  onCountChange,
}: {
  workspaceId: string;
  contacts: Contact[];
  reportEvent?: ResearchReportEvent | null;
  onCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [selectedCallId, setSelectedCallId] = useState("");
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handledEventSequence = useRef(reportEvent?.sequence ?? 0);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      setError(null);
      try {
        const next = await listReports(workspaceId);
        setItems(next);
        setSelectedCallId((current) =>
          next.some((item) => item.call_id === current) ? current : (next[0]?.call_id ?? ""),
        );
        onCountChange?.(next.filter((item) => item.status === "completed").length);
      } catch (cause) {
        if (!quiet) {
          setItems([]);
          setSelectedCallId("");
        }
        setError(cause instanceof Error ? cause.message : "Could not load reports.");
        onCountChange?.(0);
      } finally {
        if (!quiet) setLoading(false);
      }
    },
    [onCountChange, workspaceId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!reportEvent || reportEvent.data.workspace_id !== workspaceId) return;
    if (reportEvent.sequence <= handledEventSequence.current) return;
    handledEventSequence.current = reportEvent.sequence;
    void refresh(true);
  }, [refresh, reportEvent, workspaceId]);

  const selected = items.find((item) => item.call_id === selectedCallId) ?? items[0] ?? null;
  useEffect(() => {
    let cancelled = false;
    setReport(null);
    if (!selected?.id || selected.status !== "completed") return;
    void getReport(selected.id)
      .then((payload) => {
        if (!cancelled) setReport(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load report details.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.id, selected?.status]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.contact_name} ${item.agent_name} ${item.to_number} ${item.call_sid ?? ""} ${item.summary ?? ""}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, query]);
  const pendingCount = items.filter((item) => item.status === "not_started" || item.status === "failed").length;

  const analyzeOne = async (item: ReportListItem, force = false) => {
    setWorking(true);
    setError(null);
    try {
      await analyzeCall(item.call_id, force);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis could not be started.");
    } finally {
      setWorking(false);
    }
  };

  const analyzePending = async () => {
    setWorking(true);
    setError(null);
    try {
      await analyzePendingReports(workspaceId);
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis could not be started.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main id="main-content" className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border)] bg-[var(--surface)] px-6 py-4">
        <div className="relative w-80 max-sm:min-w-0 max-sm:flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Contact, agent, or Call SID"
            className="pl-9 text-xs"
            aria-label="Search reports"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void analyzePending()}
            disabled={working || pendingCount === 0}
          >
            <Sparkles className="h-3.5 w-3.5" /> Analyze Pending{pendingCount > 0 ? ` (${pendingCount})` : ""}
          </Button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mx-5 mt-4 rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] px-4 py-3 text-xs font-semibold text-[var(--red)]"
        >
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <section className="min-w-0 flex-1 overflow-y-auto p-5" aria-label="Report list">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-[var(--text)]">
              Reports{" "}
              <span className="text-[var(--text-muted)]">
                {items.filter((item) => item.status === "completed").length}
              </span>
            </p>
            <p className="text-[10px] text-[var(--text-muted)]">Completed calls without review flags</p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-xs">
            {loading ? (
              <div className="flex items-center justify-center gap-2 px-6 py-16 text-xs text-[var(--text-muted)]">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading reports
              </div>
            ) : items.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <FileSearch className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
                <p className="mt-4 text-sm font-bold text-[var(--text)]">No eligible calls</p>
                <p className="mt-1.5 text-xs text-[var(--text-muted)]">
                  Completed calls without Review flags will appear here.
                </p>
              </div>
            ) : (
              <table className="w-full min-w-[820px] text-left">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-subtle)] text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    <th className="px-4 py-3">Contact</th>
                    <th className="px-3 py-3">Agent</th>
                    <th className="px-3 py-3">Analysis</th>
                    <th className="px-3 py-3">Priority</th>
                    <th className="px-3 py-3">Assessments</th>
                    <th className="px-4 py-3">Call Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {filtered.map((item) => {
                    const contact = reportAvatar(item, contacts);
                    const status = statusCopy(item.status);
                    const priority = priorityCopy(item.priority);
                    return (
                      <tr
                        key={item.call_id}
                        onClick={() => setSelectedCallId(item.call_id)}
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") setSelectedCallId(item.call_id);
                        }}
                        className={cn(
                          "cursor-pointer outline-none transition-colors hover:bg-[var(--surface-hover)]",
                          selected?.call_id === item.call_id && "bg-[var(--blue-soft)]",
                        )}
                      >
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={contact.name} photo={contact.photo} />
                            <div className="min-w-0">
                              <p className="max-w-40 truncate text-[11px] font-bold text-[var(--text)]">
                                {contact.name}
                              </p>
                              <p className="mt-0.5 font-mono text-[9px] text-[var(--text-muted)]">{contact.phone}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                          {item.agent_name}
                        </td>
                        <td className="px-3 py-3.5">
                          <Badge tone={status.tone} dot>
                            {status.label}
                          </Badge>
                        </td>
                        <td className="px-3 py-3.5">
                          {item.priority ? (
                            <Badge tone={priority.tone} dot>
                              {priority.label}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-[var(--text-muted)]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {item.assessments.map((assessment) => (
                              <span
                                key={assessment.key}
                                className="rounded-md bg-[var(--surface-subtle)] px-1.5 py-1 text-[9px] font-bold text-[var(--text-secondary)]"
                              >
                                {assessment.form} {assessment.score}/{assessment.maximum}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-[10px] text-[var(--text-secondary)]">
                          {formatDate(item.call_started_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {selected && (
          <ReportDetail
            item={selected}
            report={report}
            contacts={contacts}
            working={working}
            onAnalyze={(force) => void analyzeOne(selected, force)}
          />
        )}
      </div>
    </main>
  );
}

function ReportDetail({
  item,
  report,
  contacts,
  working,
  onAnalyze,
}: {
  item: ReportListItem;
  report: ResearchReport | null;
  contacts: Contact[];
  working: boolean;
  onAnalyze: (force: boolean) => void;
}) {
  const contact = reportAvatar(item, contacts);
  const status = statusCopy(item.status);
  const priority = priorityCopy(report?.priority ?? item.priority);
  return (
    <aside
      className="w-[440px] shrink-0 overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)] max-xl:w-[390px] max-lg:hidden"
      aria-label="Report details"
    >
      <div className="border-b border-[var(--border)] px-5 py-5">
        <div className="flex items-start gap-3">
          <Avatar name={contact.name} photo={contact.photo} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-[var(--text)]">{contact.name}</p>
            <p className="mt-1 font-mono text-[9px] text-[var(--text-muted)]">{contact.phone}</p>
          </div>
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
        </div>
        <div className="mt-4 flex gap-2">
          {item.status === "completed" ? (
            <>
              <Button variant="secondary" size="sm" disabled={working} onClick={() => onAnalyze(true)}>
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate
              </Button>
              {report && (
                <Button variant="secondary" size="sm" onClick={() => downloadReport(report)}>
                  <Download className="h-3.5 w-3.5" /> Download
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="primary"
              size="sm"
              loading={working || item.status === "queued" || item.status === "running"}
              onClick={() => onAnalyze(item.status === "failed")}
            >
              <Sparkles className="h-3.5 w-3.5" /> Analyze Call
            </Button>
          )}
        </div>
      </div>

      {!report ? (
        <div className="px-6 py-16 text-center">
          <BrainCircuit className="mx-auto h-8 w-8 text-[var(--text-muted)]" />
          <p className="mt-4 text-sm font-bold text-[var(--text)]">
            {item.status === "failed"
              ? "Analysis failed"
              : item.status === "not_started"
                ? "Ready for analysis"
                : "Analyzing call"}
          </p>
          <p className="mt-1.5 text-xs leading-5 text-[var(--text-muted)]">
            {item.error || "Deterministic scores and transcript evidence will appear here."}
          </p>
        </div>
      ) : (
        <div className="space-y-5 p-5">
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-muted)]">Overview</p>
              <Badge tone={priority.tone} dot>
                {priority.label}
              </Badge>
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--text-secondary)]">{report.summary}</p>
            <div className="mt-3 flex gap-2">
              <Badge tone={report.data_quality === "sufficient" ? "green" : "amber"}>
                {humanize(report.data_quality)} data
              </Badge>
              {report.analysis_mode === "deterministic_fallback" && <Badge tone="amber">Scores only</Badge>}
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-[var(--purple)]" />
              <h3 className="text-xs font-bold text-[var(--text)]">Assessments</h3>
            </div>
            <div className="space-y-2">
              {report.assessments.map((assessment) => {
                const percent =
                  assessment.maximum > 0
                    ? Math.min(100, Math.max(0, (assessment.score / assessment.maximum) * 100))
                    : 0;
                return (
                  <article key={assessment.key} className="rounded-xl border border-[var(--border)] p-3.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-bold text-[var(--text)]">{assessment.form}</p>
                        <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">
                          {humanize(assessment.classification)}
                        </p>
                      </div>
                      <p className="text-base font-extrabold tabular-nums text-[var(--text)]">
                        {assessment.score}
                        <span className="text-[10px] font-medium text-[var(--text-muted)]">/{assessment.maximum}</span>
                      </p>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className={cn("h-full rounded-full", scoreTone(assessment))}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          {(report.concerns.length > 0 || report.strengths.length > 0) && (
            <section className="grid grid-cols-2 gap-2">
              {report.concerns.length > 0 && (
                <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-soft)] p-3">
                  <p className="text-[10px] font-bold text-[var(--amber)]">Concerns</p>
                  <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-[var(--text-secondary)]">
                    {report.concerns.map((value) => (
                      <li key={value}>• {value}</li>
                    ))}
                  </ul>
                </div>
              )}
              {report.strengths.length > 0 && (
                <div className="rounded-xl border border-[var(--green-border)] bg-[var(--green-soft)] p-3">
                  <p className="text-[10px] font-bold text-[var(--green)]">Strengths</p>
                  <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-[var(--text-secondary)]">
                    {report.strengths.map((value) => (
                      <li key={value}>• {value}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {report.evidence.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-[var(--text)]">Transcript Evidence</h3>
              <div className="mt-2 space-y-2">
                {report.evidence.map((evidence, index) => (
                  <article
                    key={`${evidence.turn_id}-${index}`}
                    className="rounded-xl border border-[var(--border)] p-3"
                  >
                    <div className="flex items-center justify-between">
                      <Badge tone="purple">{humanize(evidence.domain)}</Badge>
                      <span className="font-mono text-[8px] text-[var(--text-muted)]">{evidence.turn_id}</span>
                    </div>
                    <p className="mt-2 text-[10px] font-semibold leading-4 text-[var(--text)]">{evidence.finding}</p>
                    <blockquote className="mt-2 border-l-2 border-[var(--purple-border)] pl-2 text-[10px] italic leading-4 text-[var(--text-muted)]">
                      “{evidence.quote}”
                    </blockquote>
                  </article>
                ))}
              </div>
            </section>
          )}

          {report.longitudinal.length > 0 && (
            <section>
              <h3 className="text-xs font-bold text-[var(--text)]">Changes Since Previous Call</h3>
              <div className="mt-2 space-y-2">
                {report.longitudinal.map((change) => (
                  <div
                    key={change.assessment_key}
                    className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5"
                  >
                    {change.direction === "improved" ? (
                      <TrendingDown className="h-4 w-4 text-[var(--green)]" />
                    ) : change.direction === "worsened" ? (
                      <TrendingUp className="h-4 w-4 text-[var(--red)]" />
                    ) : (
                      <Activity className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-bold text-[var(--text)]">{change.form}</p>
                      <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">
                        {change.previous_score} → {change.current_score}
                      </p>
                    </div>
                    <Badge
                      tone={
                        change.direction === "improved" ? "green" : change.direction === "worsened" ? "red" : "neutral"
                      }
                    >
                      {humanize(change.direction)}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          )}

          <p className="border-t border-[var(--border)] pt-4 text-[9px] leading-4 text-[var(--text-muted)]">
            {report.disclaimer}
          </p>
        </div>
      )}
    </aside>
  );
}
