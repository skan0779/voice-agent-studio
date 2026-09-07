import { Bell, Moon, Search, Sun } from "lucide-react";
import type { SectionId } from "./Sidebar";
import { Tooltip } from "./ui/Tooltip";
import { Button } from "./ui/Button";

const titles: Record<SectionId, { title: string; eyebrow: string }> = {
  workspaces: { title: "Workspaces", eyebrow: "Voice Agent Studio" },
  overview: { title: "Overview", eyebrow: "Voice Agent Studio" },
  builder: { title: "Agent Builder", eyebrow: "Voice Agents" },
  contacts: { title: "Contacts", eyebrow: "Call Recipients" },
  live: { title: "Call Live", eyebrow: "Realtime Monitoring" },
  calls: { title: "Call Records", eyebrow: "Observability" },
  reports: { title: "Reports", eyebrow: "Post-call Research" },
  tools: { title: "Tools", eyebrow: "Agent capabilities" },
  functions: { title: "Functions", eyebrow: "Service runtime" },
  state: { title: "State", eyebrow: "Service runtime" },
  data: { title: "Data", eyebrow: "Agent resources" },
  deployments: { title: "Deployments", eyebrow: "Outbound Calls" },
  settings: { title: "Settings", eyebrow: "Workspace configuration" },
  help: { title: "Help", eyebrow: "Studio Guide" },
};

export function TopHeader({
  section,
  title,
  eyebrow,
  dark,
  onToggleTheme,
}: {
  section: SectionId;
  title?: string;
  eyebrow?: string;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  const copy = titles[section];
  return (
    <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {eyebrow ?? copy.eyebrow}
        </p>
        <h1 className="mt-1 truncate text-[17px] font-bold tracking-[-0.02em] text-[var(--text)]">
          {title ?? copy.title}
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        <button className="mr-3 hidden h-9 w-64 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 text-left text-xs text-[var(--text-muted)] outline-none transition-colors hover:border-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] xl:flex">
          <Search className="h-3.5 w-3.5" aria-hidden="true" />
          Search
          <kbd className="ml-auto rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 font-mono text-[9px]">
            ⌘ K
          </kbd>
        </button>
        <Tooltip content={dark ? "Light mode" : "Dark mode"}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleTheme}
            aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </Tooltip>
        <Tooltip content="Notifications">
          <Button variant="ghost" size="icon" aria-label="Open notifications" className="relative">
            <Bell className="h-4 w-4" />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--red)] ring-2 ring-[var(--surface)]" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
