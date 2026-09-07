import { Braces, MemoryStick } from "lucide-react";

export function RuntimeLibraryScreen({ kind }: { kind: "functions" | "state" }) {
  const isFunctions = kind === "functions";
  const Icon = isFunctions ? Braces : MemoryStick;
  return (
    <main id="main-content" className="min-h-0 flex-1 overflow-y-auto bg-[var(--app-bg)] p-6 max-md:p-4">
      <div className="mx-auto max-w-[1280px]">
        <h2 className="text-xl font-extrabold tracking-[-0.03em] text-[var(--text)]">
          {isFunctions ? "Functions" : "State"}
        </h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {isFunctions
            ? "Manage service functions that execute Tool calls."
            : "Define the state values managed by this service."}
        </p>
        <div className="mt-6 rounded-2xl border border-dashed border-[var(--border-strong)] bg-[var(--surface)] px-6 py-20 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--blue-soft)] text-[var(--blue)]">
            <Icon className="h-6 w-6" />
          </div>
          <h3 className="mt-5 text-sm font-bold text-[var(--text)]">
            {isFunctions ? "No functions yet" : "No state variables yet"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--text-muted)]">
            {isFunctions
              ? "Registered handlers and custom service actions will be managed here."
              : "Call-scoped and persistent service state will be managed here."}
          </p>
        </div>
      </div>
    </main>
  );
}
