import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
}

export function Badge({ className, tone = "neutral", dot, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-[11px] font-semibold",
        tone === "neutral" && "border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--text-secondary)]",
        tone === "blue" && "border-[var(--blue-border)] bg-[var(--blue-soft)] text-[var(--blue)]",
        tone === "green" && "border-[var(--green-border)] bg-[var(--green-soft)] text-[var(--green)]",
        tone === "amber" && "border-[var(--amber-border)] bg-[var(--amber-soft)] text-[var(--amber)]",
        tone === "red" && "border-[var(--red-border)] bg-[var(--red-soft)] text-[var(--red)]",
        tone === "purple" && "border-[var(--purple-border)] bg-[var(--purple-soft)] text-[var(--purple)]",
        className,
      )}
      {...props}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  );
}
