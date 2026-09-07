import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { cn } from "../../lib/cn";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  labelAction,
  labelActionPosition = "end",
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  labelAction?: ReactNode;
  labelActionPosition?: "adjacent" | "end";
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "flex items-center",
          labelActionPosition === "adjacent" ? "justify-start gap-1.5" : "justify-between gap-2",
        )}
      >
        <label htmlFor={htmlFor} className="block text-xs font-semibold text-[var(--text)]">
          {label}
        </label>
        {labelAction}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-[11px] leading-5 text-[var(--red)]" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[11px] leading-5 text-[var(--text-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none transition-shadow placeholder:text-[var(--text-muted)] focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)] aria-invalid:border-[var(--red)] aria-invalid:focus:border-[var(--red)] aria-invalid:focus:ring-[var(--red-soft)]",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-28 w-full resize-y rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 text-sm leading-6 text-[var(--text)] outline-none transition-shadow placeholder:text-[var(--text-muted)] focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]",
        className,
      )}
      {...props}
    />
  );
});

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full cursor-pointer rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--blue)] focus:ring-2 focus:ring-[var(--blue-soft)]",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
