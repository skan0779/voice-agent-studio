import {
  Braces,
  ChevronDown,
  CircleHelp,
  Database,
  FileChartColumn,
  LayoutDashboard,
  Library,
  MemoryStick,
  MessageSquareText,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Rocket,
  Settings,
  UsersRound,
  Wrench,
  Workflow,
} from "lucide-react";
import { Fragment, useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { cn } from "../lib/cn";
import { Tooltip } from "./ui/Tooltip";

export type SectionId =
  | "workspaces"
  | "overview"
  | "builder"
  | "contacts"
  | "live"
  | "calls"
  | "reports"
  | "tools"
  | "functions"
  | "state"
  | "data"
  | "deployments"
  | "settings"
  | "help";

type PrimarySectionId = "overview" | keyof SidebarCounts;

const primaryItems: Array<{
  id: PrimarySectionId;
  label: string;
  icon: typeof Workflow;
  tone?: "green";
}> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "builder", label: "Agent Builder", icon: Workflow },
  { id: "tools", label: "Tools", icon: Wrench, tone: "green" },
  { id: "functions", label: "Functions", icon: Braces },
  { id: "state", label: "State", icon: MemoryStick },
  { id: "data", label: "Data", icon: Database },
  { id: "deployments", label: "Deployments", icon: Rocket },
  { id: "contacts", label: "Contacts", icon: UsersRound },
  { id: "live", label: "Call Live", icon: Radio },
  { id: "calls", label: "Call Records", icon: MessageSquareText },
  { id: "reports", label: "Reports", icon: FileChartColumn },
];

export interface SidebarCounts {
  builder: number;
  tools: number;
  functions: number;
  state: number;
  data: number;
  deployments: number;
  contacts: number;
  live: number;
  calls: number;
  reports: number;
}

const SIDEBAR_COLLAPSED_KEY = "voice-agent-studio.sidebar-collapsed";

export function Sidebar({
  active,
  workspaceName,
  workspaceDescription,
  counts,
  onChange,
  onOpenWorkspaces,
}: {
  active: SectionId;
  workspaceName: string | null;
  workspaceDescription: string | null;
  counts: SidebarCounts;
  onChange: (section: SectionId) => void;
  onOpenWorkspaces: () => void;
}) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true");

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  }, [collapsed]);

  const labelClassName = collapsed ? "hidden" : "max-lg:hidden";

  return (
    <aside
      className={cn(
        "relative flex h-dvh shrink-0 flex-col border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-4 transition-[width] duration-200 ease-out",
        collapsed ? "w-[72px]" : "w-[232px] max-lg:w-[72px]",
      )}
    >
      <Tooltip content={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="absolute -right-3 top-5 z-20 hidden h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-sm outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:flex"
        >
          {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
        </button>
      </Tooltip>

      <div
        className={cn(
          "pb-5",
          collapsed ? "flex justify-center px-1" : "px-2 max-lg:flex max-lg:justify-center max-lg:px-1",
        )}
      >
        {collapsed ? (
          <BrandMark compact />
        ) : (
          <>
            <div className="max-lg:hidden">
              <BrandMark />
            </div>
            <div className="hidden max-lg:flex">
              <BrandMark compact />
            </div>
          </>
        )}
      </div>

      <button
        onClick={onOpenWorkspaces}
        aria-label="Open workspace switcher"
        aria-current={active === "workspaces" ? "page" : undefined}
        className={cn(
          "mb-5 flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-left shadow-xs outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-lg:justify-center max-lg:px-0",
          collapsed && "justify-center px-0",
          active === "workspaces" && "border-[var(--blue-border)] bg-[var(--blue-soft)]",
        )}
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--blue-soft)] text-[var(--blue)]">
          <Library className="h-3.5 w-3.5" aria-hidden="true" />
        </div>
        <div className={cn("min-w-0 flex-1", labelClassName)}>
          <p className="truncate text-xs font-bold text-[var(--text)]">{workspaceName ?? "Select workspace"}</p>
          <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">
            {workspaceDescription || "No description"}
          </p>
        </div>
        <ChevronDown className={cn("h-3.5 w-3.5 text-[var(--text-muted)]", labelClassName)} aria-hidden="true" />
      </button>

      <nav aria-label="Primary navigation" className="space-y-1">
        {primaryItems.map((item) => {
          const Icon = item.icon;
          const count = item.id === "overview" ? null : counts[item.id];
          const button = (
            <button
              onClick={() => onChange(item.id)}
              aria-current={active === item.id ? "page" : undefined}
              className={cn(
                "group flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-lg:justify-center max-lg:px-0",
                collapsed && "justify-center px-0",
                active === item.id
                  ? "bg-[var(--nav-active)] font-semibold text-[var(--text)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
              )}
            >
              <Icon
                className={cn(
                  "h-[17px] w-[17px] shrink-0",
                  item.tone === "green"
                    ? "text-[var(--green)]"
                    : active === item.id
                      ? "text-[var(--blue)]"
                      : "text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]",
                )}
                aria-hidden="true"
              />
              <span className={cn("flex-1 text-left", labelClassName)}>{item.label}</span>
              {count !== null && (
                <span
                  aria-label={`${count} ${item.label.toLowerCase()}`}
                  className={cn(
                    "h-5 min-w-5 items-center justify-center rounded-full bg-[#dbeafe] px-1.5 text-[10px] font-extrabold tabular-nums text-[#1d4ed8] ring-1 ring-inset ring-[#93c5fd]/70 dark:bg-[#1e3a5f] dark:text-[#bfdbfe] dark:ring-[#3b82f6]/45",
                    collapsed ? "hidden" : "flex max-lg:hidden",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
          return (
            <Fragment key={item.id}>
              <Tooltip content={item.label}>{button}</Tooltip>
              {(item.id === "overview" || item.id === "data") && (
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  className="mx-2 my-2 border-t border-[var(--border)]"
                />
              )}
            </Fragment>
          );
        })}
      </nav>

      <div className="mt-auto space-y-1 border-t border-[var(--border)] pt-4">
        <Tooltip content="Settings">
          <button
            onClick={() => onChange("settings")}
            aria-current={active === "settings" ? "page" : undefined}
            className={cn(
              "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-lg:justify-center max-lg:px-0",
              collapsed && "justify-center px-0",
              active === "settings" ? "bg-[var(--nav-active)] text-[var(--text)]" : "text-[var(--text-secondary)]",
            )}
          >
            <Settings className="h-[17px] w-[17px] text-[var(--text-muted)]" aria-hidden="true" />
            <span className={labelClassName}>Settings</span>
          </button>
        </Tooltip>
        <Tooltip content="Help">
          <button
            onClick={() => onChange("help")}
            aria-current={active === "help" ? "page" : undefined}
            className={cn(
              "flex h-10 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-sm font-medium outline-none transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] max-lg:justify-center max-lg:px-0",
              collapsed && "justify-center px-0",
              active === "help" ? "bg-[var(--nav-active)] text-[var(--text)]" : "text-[var(--text-secondary)]",
            )}
          >
            <CircleHelp className="h-[17px] w-[17px] text-[var(--text-muted)]" aria-hidden="true" />
            <span className={labelClassName}>Help</span>
          </button>
        </Tooltip>
        <div
          className={cn(
            "mt-3 flex items-center gap-3 px-2 py-2 max-lg:justify-center max-lg:px-0",
            collapsed && "justify-center px-0",
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-700 to-blue-600 text-xs font-bold text-white">
            VA
          </div>
          <div className={cn("min-w-0", labelClassName)}>
            <p className="truncate text-xs font-bold text-[var(--text)]">Studio Admin</p>
            <p className="truncate text-[10px] text-[var(--text-muted)]">admin@example.com</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
