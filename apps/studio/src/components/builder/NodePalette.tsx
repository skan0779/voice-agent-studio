import { CircleStop, MessageCircleMore, Play, Search, Unplug } from "lucide-react";
import { useState } from "react";
import type { NodeKind } from "../../domain/flow";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Input } from "../ui/Field";

export interface NodeTemplate {
  kind: Exclude<NodeKind, "tool">;
}

const catalog: Array<
  NodeTemplate & {
    id: string;
    title: string;
    description: string;
    icon: typeof Play;
    color: string;
  }
> = [
  {
    id: "start",
    kind: "start",
    title: "Start",
    description: "Initialize the Realtime session",
    icon: Play,
    color: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300",
  },
  {
    id: "node",
    kind: "node",
    title: "Node",
    description: "Configure response, tools, and routing",
    icon: MessageCircleMore,
    color: "text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-300",
  },
  {
    id: "end",
    kind: "end",
    title: "End",
    description: "Finish playback and end the call",
    icon: CircleStop,
    color: "text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300",
  },
];

export function NodePalette({ onAdd, hasStart }: { onAdd: (template: NodeTemplate) => void; hasStart: boolean }) {
  const [query, setQuery] = useState("");
  const filtered = catalog.filter((item) =>
    `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()),
  );

  const onDragStart = (event: React.DragEvent, template: NodeTemplate) => {
    event.dataTransfer.setData("application/voice-agent-studio-node", JSON.stringify(template));
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="flex w-[224px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--surface)] max-xl:w-[196px] max-md:hidden">
      <div className="border-b border-[var(--border)] px-4 py-4">
        <h2 className="text-xs font-bold text-[var(--text)]">Flow Components</h2>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]" />
          <Input
            aria-label="Search blocks"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search blocks"
            className="h-9 pl-9 text-xs"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">Blocks</p>
        <div className="space-y-2">
          {filtered.map((item) => {
            const Icon = item.icon;
            const disabled = item.kind === "start" && hasStart;
            return (
              <button
                key={item.id}
                draggable={!disabled}
                disabled={disabled}
                onDragStart={(event) => onDragStart(event, item)}
                onClick={() => onAdd(item)}
                className={cn(
                  "group flex min-h-[64px] w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 text-left outline-none transition-[border-color,box-shadow,transform] focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                  disabled
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-grab hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-md active:cursor-grabbing",
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", item.color)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[11px] font-bold text-[var(--text)]">
                    {item.title}
                    {disabled && <Badge>In use</Badge>}
                  </span>
                  <span className="mt-0.5 block text-[9px] leading-4 text-[var(--text-muted)]">{item.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="mb-2 mt-6 px-1 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Connection
        </p>
        <div className="rounded-xl border border-dashed border-[var(--blue-border)] bg-[var(--blue-soft)] p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--blue)]">
            <Unplug className="h-3.5 w-3.5" /> Edge
          </div>
          <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-secondary)]">
            Drag from a block handle to connect it. Select the line to configure AND/OR conditions.
          </p>
        </div>
      </div>
    </aside>
  );
}
