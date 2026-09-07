import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "./Button";

interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "default" | "large";
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = "default" }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-[2px] data-[state=open]:animate-[fade-in_160ms_ease-out]" />
        <DialogPrimitive.Content
          className={`fixed left-1/2 top-1/2 z-50 ${size === "large" ? "w-[min(94vw,760px)]" : "w-[min(92vw,520px)]"} -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl outline-none data-[state=open]:animate-[dialog-in_180ms_ease-out]`}
        >
          <div className="flex items-start justify-between border-b border-[var(--border)] px-6 py-5">
            <div>
              <DialogPrimitive.Title className="text-lg font-bold tracking-[-0.02em] text-[var(--text)]">
                {title}
              </DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description className="mt-1.5 text-sm leading-6 text-[var(--text-secondary)]">
                  {description}
                </DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close dialog">
                <X className="h-4 w-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-subtle)] px-6 py-4">
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
