import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Bot, Check, CircleStop, GitBranch, MessageCircleMore, Play, Wrench } from "lucide-react";
import type { VoiceNode } from "../../domain/flow";
import { cn } from "../../lib/cn";

const handlePositions = [
  { id: "top", position: Position.Top },
  { id: "right", position: Position.Right },
  { id: "bottom", position: Position.Bottom },
  { id: "left", position: Position.Left },
] as const;

function visualFor(data: VoiceNode["data"]) {
  if (data.kind === "start")
    return {
      icon: Play,
      label: "START",
      iconClass: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
      borderClass: "border-l-emerald-500",
    };
  if (data.kind === "end")
    return {
      icon: CircleStop,
      label: "END",
      iconClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
      borderClass: "border-l-slate-500",
    };
  if (data.kind === "tool")
    return {
      icon: Wrench,
      label: "TOOL",
      iconClass: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
      borderClass: "border-l-cyan-500",
    };
  return {
    icon: MessageCircleMore,
    label: "NODE",
    iconClass: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    borderClass: "border-l-blue-500",
  };
}

const responseLabel = {
  manual: "Manual",
  automatic: "Automatic",
  none: "No response",
};

export function VoiceFlowNode({ data, selected }: NodeProps<VoiceNode>) {
  const visual = visualFor(data);
  const Icon = visual.icon;
  const isActive = Boolean(data.runtimeActive);
  const canStartConnection = data.kind !== "end";
  const toolCount = typeof data.availableToolCount === "number" ? data.availableToolCount : data.toolIds.length;

  return (
    <div
      className={cn(
        "relative w-[258px] rounded-xl border border-l-[3px] border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_2px_8px_rgba(15,23,42,0.06)] transition-[border-color,box-shadow,transform] duration-200",
        visual.borderClass,
        selected &&
          "border-[var(--blue)] border-l-[var(--blue)] shadow-[0_0_0_3px_var(--blue-soft),0_8px_20px_rgba(15,23,42,0.11)]",
        isActive && "node-runtime-active border-[var(--green)] border-l-[var(--green)]",
      )}
      aria-label={`${data.name}, ${visual.label} block`}
    >
      {handlePositions.map(({ id, position }) => (
        <Handle
          key={id}
          id={id}
          type="source"
          position={position}
          isConnectableStart={canStartConnection}
          isConnectableEnd
          className="!h-3 !w-3 !border-2 !border-[var(--surface)] !bg-[var(--handle)] transition-transform hover:!scale-125"
        />
      ))}
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", visual.iconClass)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.09em] text-[var(--text-muted)]">
              {visual.label}
            </span>
            {data.health === "ready" ? (
              <Check className="h-3.5 w-3.5 text-[var(--green)]" aria-label="Configured" />
            ) : (
              <span className="h-2 w-2 rounded-full bg-[var(--amber)]" aria-label="Needs review" />
            )}
          </div>
          <h3 className="mt-1 truncate text-[13px] font-bold text-[var(--text)]">{data.name}</h3>
        </div>
      </div>
      <div className="border-t border-[var(--border)] px-4 py-3">
        {(data.kind === "node" || data.kind === "tool") && (
          <p className="line-clamp-2 min-h-9 text-[11px] leading-[18px] text-[var(--text-secondary)]">
            {data.description}
          </p>
        )}
        <div
          className={cn(
            "flex items-center justify-between gap-2 overflow-hidden",
            (data.kind === "node" || data.kind === "tool") && "mt-3",
          )}
        >
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
            {data.kind === "start" && data.startConfig && (
              <span className="shrink-0 rounded bg-[var(--green-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--green)]">
                {data.startConfig.model}
              </span>
            )}
            {data.kind === "start" && typeof data.stateSchemaName === "string" && (
              <span className="min-w-0 truncate rounded bg-[var(--blue-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--blue)]">
                {data.stateSchemaName}
              </span>
            )}
            {data.kind === "node" && (
              <span className="shrink-0 rounded bg-[var(--surface-subtle)] px-1.5 py-1 text-[9px] font-semibold text-[var(--text-muted)]">
                {responseLabel[data.responseMode]}
              </span>
            )}
            {data.kind === "node" && data.runtime && (
              <span className="shrink-0 rounded bg-[var(--blue-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--blue)]">
                {data.runtime.outputModalities === "audio" ? "Audio" : "Text"}
              </span>
            )}
            {data.kind === "tool" && (
              <span className="shrink-0 rounded bg-[var(--blue-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--blue)]">
                Tool call
              </span>
            )}
            {data.kind === "end" && data.endConfig?.saveTranscript && (
              <span className="shrink-0 rounded bg-[var(--blue-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--blue)]">
                Transcript
              </span>
            )}
          </div>
          {data.kind === "node" && (
            <div className="flex shrink-0 items-center gap-1.5">
              {toolCount > 0 && (
                <span
                  className="flex items-center gap-1 rounded bg-[var(--green-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--green)]"
                  aria-label={`${toolCount} Tools`}
                >
                  <Bot className="h-2.5 w-2.5" />
                  <span>{toolCount}</span>
                </span>
              )}
              {typeof data.outgoingEdgeCount === "number" && data.outgoingEdgeCount > 0 && (
                <span
                  className="flex items-center gap-1 rounded bg-[var(--amber-soft)] px-1.5 py-1 text-[9px] font-semibold text-[var(--amber)]"
                  aria-label={`${data.outgoingEdgeCount} Edges`}
                >
                  <GitBranch className="h-2.5 w-2.5" />
                  <span>{data.outgoingEdgeCount}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {isActive && (
        <div className="absolute -right-2 -top-2 flex h-5 items-center gap-1 rounded-full bg-[var(--green)] px-2 text-[9px] font-bold text-white shadow-lg">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Running
        </div>
      )}
    </div>
  );
}
