import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import type { ValidationIssue } from "../../domain/flow";
import { cn } from "../../lib/cn";

export function ValidationConsole({
  open,
  issues,
  onToggle,
  onSelectNode,
}: {
  open: boolean;
  issues: ValidationIssue[];
  onToggle: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const errorCount = issues.filter((issue) => issue.level === "error").length;

  return (
    <section
      className={cn(
        "shrink-0 border-t border-[var(--border)] bg-[var(--surface)] transition-[height] duration-200",
        open ? "h-[248px]" : "h-10",
      )}
      aria-label="Validation console"
    >
      <div className="flex h-10 items-center border-b border-[var(--border)] px-3">
        <button
          type="button"
          onClick={() => {
            if (!open) onToggle();
          }}
          className={cn(
            "flex h-full cursor-pointer items-center gap-1.5 border-b-2 px-3 text-[10px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
            open
              ? "border-[var(--blue)] text-[var(--blue)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
          )}
          aria-expanded={open}
        >
          {errorCount > 0 ? (
            <AlertCircle className="h-3.5 w-3.5 text-[var(--red)]" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          Validation {issues.length}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          aria-label={open ? "Collapse validation" : "Expand validation"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <div className="h-[207px] overflow-y-auto p-4">
          {issues.length === 0 ? (
            <div className="flex h-full items-center justify-center gap-3">
              <CheckCircle2 className="h-7 w-7 text-[var(--green)]" />
              <div>
                <p className="text-xs font-bold text-[var(--text)]">Ready to deploy</p>
                <p className="mt-1 text-[10px] text-[var(--text-muted)]">
                  Required routes and response settings are valid.
                </p>
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-2">
              {issues.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => issue.nodeId && onSelectNode(issue.nodeId)}
                  className="flex w-full cursor-pointer items-start gap-3 rounded-xl border border-[var(--border)] p-3 text-left outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                >
                  <AlertCircle
                    className={cn(
                      "mt-0.5 h-4 w-4",
                      issue.level === "error" ? "text-[var(--red)]" : "text-[var(--amber)]",
                    )}
                  />
                  <span>
                    <span className="block text-[11px] font-bold text-[var(--text)]">{issue.title}</span>
                    <span className="mt-1 block text-[9px] text-[var(--text-muted)]">{issue.description}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
