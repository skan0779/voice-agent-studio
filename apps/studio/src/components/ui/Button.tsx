import { forwardRef, type ButtonHTMLAttributes } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "icon";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", loading = false, disabled, children, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg border text-sm font-semibold outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45",
        variant === "primary" &&
          "border-[var(--primary)] bg-[var(--primary)] text-white shadow-sm hover:bg-[var(--primary-hover)]",
        variant === "secondary" &&
          "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)] shadow-xs hover:bg-[var(--surface-hover)]",
        variant === "ghost" &&
          "border-transparent bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
        variant === "danger" &&
          "border-[var(--danger-soft)] bg-[var(--danger-soft)] text-[var(--danger)] hover:border-[var(--danger)]",
        size === "sm" && "h-8 px-3 text-xs",
        size === "md" && "h-10 px-4",
        size === "icon" && "h-9 w-9 p-0",
        className,
      )}
      {...props}
    >
      {loading && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  ),
);

Button.displayName = "Button";
