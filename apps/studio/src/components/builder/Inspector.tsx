import {
  ChevronRight,
  CircleAlert,
  CircleHelp,
  GitBranch,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Radio,
  Trash2,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ConditionComparator,
  ConditionRule,
  EndConfig,
  RouteData,
  StartConfig,
  ToolDefinition,
  ToolFunctionBinding,
  ToolInputBinding,
  VoiceEdge,
  VoiceNode,
  VoiceNodeData,
} from "../../domain/flow";
import type { DataReferenceSuggestion } from "../../domain/dataReferences";
import type { ServiceFunction } from "../../domain/functions";
import { listStateReferenceSuggestions } from "../../domain/stateReferences";
import { countStateFields, type StateSchema } from "../../domain/state";
import { cn } from "../../lib/cn";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Field, Input, Select, Textarea } from "../ui/Field";
import { Tooltip } from "../ui/Tooltip";
import { DataReferenceInput } from "../ui/DataReferenceInput";

type InspectorTab = "content" | "state" | "instruction" | "runtime" | "tools" | "routes" | "transcription";

const INSPECTOR_WIDTH_KEY = "voice-agent-studio:inspector-width";
const INSPECTOR_COLLAPSED_KEY = "voice-agent-studio:inspector-collapsed";
const DEFAULT_INSPECTOR_WIDTH = 348;
const MIN_INSPECTOR_WIDTH = 300;
const MAX_INSPECTOR_WIDTH = 600;

const kindNames = { start: "Start", node: "Node", tool: "Tool", end: "End" };
export function Inspector({
  node,
  edge,
  tools,
  functions,
  stateSchemas,
  selectedStateSchemaId,
  bindingSuggestions,
  edges,
  onUpdateNode,
  onUpdateEdge,
  onSelectStateSchema,
  onDeleteNode,
  onDeleteEdge,
  onSelectEdge,
  canDeleteNode,
}: {
  node: VoiceNode | null;
  edge: VoiceEdge | null;
  tools: ToolDefinition[];
  functions: ServiceFunction[];
  stateSchemas: StateSchema[];
  selectedStateSchemaId: string;
  bindingSuggestions: DataReferenceSuggestion[];
  edges: VoiceEdge[];
  onUpdateNode: (nodeId: string, patch: Partial<VoiceNodeData>) => void;
  onUpdateEdge: (edgeId: string, patch: Partial<RouteData>) => void;
  onSelectStateSchema: (stateSchemaId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  canDeleteNode: boolean;
}) {
  const [tab, setTab] = useState<InspectorTab>("content");
  const [collapsed, setCollapsed] = useState(readInspectorCollapsed);
  const { width, beginResize, resizeWithKeyboard } = useInspectorResize();
  const outgoingEdges = useMemo(
    () => (node ? edges.filter((candidate) => candidate.source === node.id) : []),
    [edges, node],
  );

  useEffect(() => setTab("content"), [node?.id, edge?.id]);
  useEffect(() => saveInspectorCollapsed(collapsed), [collapsed]);

  if (!node && !edge) return null;

  if (collapsed) return <CollapsedInspectorButton onExpand={() => setCollapsed(false)} />;

  if (edge) {
    return (
      <EdgeInspector
        edge={edge}
        stateSchema={stateSchemas.find((schema) => schema.id === selectedStateSchemaId) ?? null}
        inspectorWidth={width}
        onResizeStart={beginResize}
        onResizeKeyDown={resizeWithKeyboard}
        onCollapse={() => setCollapsed(true)}
        onUpdate={(patch) => onUpdateEdge(edge.id, patch)}
        onDelete={() => onDeleteEdge(edge.id)}
      />
    );
  }

  if (!node) return null;

  const update = (patch: Partial<VoiceNodeData>) => onUpdateNode(node.id, patch);
  const tabs: Array<[InspectorTab, string]> =
    node.data.kind === "start"
      ? [
          ["content", "Base"],
          ["state", "State"],
          ["tools", "Instruction"],
          ["runtime", "Turn Detection"],
          ["transcription", "Transcription"],
        ]
      : node.data.kind === "node"
        ? [
            ["content", "Content"],
            ["instruction", "Instruction"],
            ["runtime", "Response"],
            ["tools", "Tool"],
            ["routes", "Edge"],
          ]
        : node.data.kind === "tool"
          ? [
              ["content", "Content"],
              ["runtime", "Execution"],
              ["routes", `Edges ${outgoingEdges.length}`],
            ]
          : [["content", "Base"]];

  return (
    <InspectorAside
      width={width}
      onResizeStart={beginResize}
      onResizeKeyDown={resizeWithKeyboard}
      onCollapse={() => setCollapsed(true)}
    >
      <div className="border-b border-[var(--border)] px-5 pb-0 pt-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Badge
              tone={
                node.data.kind === "tool"
                  ? "purple"
                  : node.data.kind === "start"
                    ? "green"
                    : node.data.kind === "end"
                      ? "amber"
                      : "blue"
              }
            >
              {kindNames[node.data.kind]}
            </Badge>
            <h2 className="truncate text-sm font-bold text-[var(--text)]" title={node.data.name}>
              {node.data.name}
            </h2>
          </div>
          {canDeleteNode && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onDeleteNode(node.id)}
              aria-label={`Delete ${node.data.name}`}
              className="h-8 w-8 shrink-0 text-[var(--text-muted)] hover:text-[var(--danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Block settings">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "shrink-0 cursor-pointer border-b-2 px-2.5 pb-3 text-[10px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                tab === id
                  ? "border-[var(--blue)] text-[var(--blue)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-5">
        {node.data.kind === "start" && (
          <StartEditor
            node={node}
            tab={tab}
            update={update}
            stateSchemas={stateSchemas}
            selectedStateSchemaId={selectedStateSchemaId}
            bindingSuggestions={bindingSuggestions}
            onSelectStateSchema={onSelectStateSchema}
          />
        )}
        {node.data.kind === "node" && (
          <NodeEditor
            node={node}
            tab={tab}
            tools={tools}
            functions={functions}
            bindingSuggestions={bindingSuggestions}
            outgoingEdges={outgoingEdges}
            update={update}
            onSelectEdge={onSelectEdge}
          />
        )}
        {node.data.kind === "tool" && (
          <ToolEditor
            node={node}
            tab={tab}
            tools={tools}
            outgoingEdges={outgoingEdges}
            update={update}
            onSelectEdge={onSelectEdge}
          />
        )}
        {node.data.kind === "end" && <EndEditor node={node} update={update} />}
      </div>
      <div className="border-t border-[var(--border)] p-4">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          disabled={!canDeleteNode}
          onClick={() => onDeleteNode(node.id)}
          aria-describedby="delete-node-help"
        >
          {canDeleteNode ? <Trash2 className="h-3.5 w-3.5" /> : <LockKeyhole className="h-3.5 w-3.5" />}Delete
        </Button>
        <p id="delete-node-help" className="mt-2 text-center text-[9px] leading-4 text-[var(--text-muted)]">
          {canDeleteNode ? "You can also press Delete or Backspace." : "Every Flow requires exactly one Start block."}
        </p>
      </div>
    </InspectorAside>
  );
}

function StartEditor({
  node,
  tab,
  update,
  stateSchemas,
  selectedStateSchemaId,
  bindingSuggestions,
  onSelectStateSchema,
}: {
  node: VoiceNode;
  tab: InspectorTab;
  update: (patch: Partial<VoiceNodeData>) => void;
  stateSchemas: StateSchema[];
  selectedStateSchemaId: string;
  bindingSuggestions: DataReferenceSuggestion[];
  onSelectStateSchema: (stateSchemaId: string) => void;
}) {
  const config = node.data.startConfig!;
  const updateConfig = (patch: Partial<StartConfig>) => update({ startConfig: { ...config, ...patch } });
  const updateVad = (patch: Partial<StartConfig["turnDetection"]>) =>
    updateConfig({ turnDetection: { ...config.turnDetection, ...patch } });
  const updateTranscription = (patch: Partial<StartConfig["transcription"]>) =>
    updateConfig({ transcription: { ...config.transcription, ...patch } });

  if (tab === "content")
    return (
      <div className="space-y-5">
        <Field label="Model" htmlFor="start-model">
          <Select
            id="start-model"
            value={config.model}
            onChange={(event) => updateConfig({ model: event.target.value as StartConfig["model"] })}
          >
            <option value="gpt-realtime-2.1">gpt-realtime-2.1</option>
          </Select>
        </Field>
        <Field label="Language" htmlFor="start-language">
          <Select
            id="start-language"
            value={config.language}
            onChange={(event) => updateConfig({ language: event.target.value as StartConfig["language"] })}
          >
            <option value="ko">Korean</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field
          label="Voice"
          htmlFor="start-voice"
          labelActionPosition="adjacent"
          labelAction={<FieldHelp text="Voice cannot be changed after the first audio output." />}
        >
          <Select
            id="start-voice"
            value={config.voice}
            onChange={(event) => updateConfig({ voice: event.target.value as StartConfig["voice"] })}
          >
            <option value="marin">Marin</option>
            <option value="cedar">Cedar</option>
            <option value="coral">Coral</option>
            <option value="sage">Sage</option>
          </Select>
        </Field>
        <Field label="Speed" htmlFor="start-speed">
          <div className="flex items-center gap-3">
            <input
              id="start-speed"
              type="range"
              min="0.25"
              max="1.5"
              step="0.05"
              value={config.speed}
              onChange={(event) => updateConfig({ speed: Number(event.target.value) })}
              className="min-w-0 flex-1 accent-[var(--blue)]"
            />
            <Badge>{config.speed.toFixed(2)}×</Badge>
          </div>
        </Field>
        <Field
          label="Initial Input Gate"
          htmlFor="initial-gate"
          labelActionPosition="adjacent"
          labelAction={<FieldHelp text="Gateway delay before accepting input; this is not an OpenAI VAD field." />}
        >
          <NumberInput
            id="initial-gate"
            value={config.initialInputGateMs}
            min={0}
            step={100}
            suffix="ms"
            onChange={(value) => updateConfig({ initialInputGateMs: value })}
          />
        </Field>
      </div>
    );

  if (tab === "state") {
    const selected = stateSchemas.find((schema) => schema.id === selectedStateSchemaId) ?? null;
    return (
      <div className="space-y-5">
        <Field label="State Schema" htmlFor="start-state-schema">
          <Select
            id="start-state-schema"
            value={selectedStateSchemaId}
            disabled={stateSchemas.length === 0}
            onChange={(event) => onSelectStateSchema(event.target.value)}
          >
            {stateSchemas.length === 0 ? (
              <option value="">None</option>
            ) : (
              stateSchemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name}
                </option>
              ))
            )}
          </Select>
        </Field>
        {selected ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[11px] font-bold text-[var(--text)]">{selected.name}</p>
                <p className="mt-1 truncate font-mono text-[9px] text-[var(--blue)]">{selected.key}</p>
                <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-muted)]">
                  {selected.description || "No description"}
                </p>
              </div>
              <Badge tone="blue">Assigned</Badge>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[var(--border)] pt-3">
              <div>
                <p className="text-[9px] text-[var(--text-muted)]">Objects</p>
                <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{selected.groups.length}</p>
              </div>
              <div>
                <p className="text-[9px] text-[var(--text-muted)]">Fields</p>
                <p className="mt-1 text-sm font-extrabold text-[var(--text)]">{countStateFields(selected)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-7 text-center text-[10px] leading-5 text-[var(--text-muted)]">
            Create a State Schema on the State page, then assign it here.
          </div>
        )}
      </div>
    );
  }

  if (tab === "tools")
    return (
      <div className="space-y-5">
        <Field
          label="Global Instruction"
          htmlFor="base-instructions"
          labelAction={
            <Tooltip content="Applied to every Node response. The Runtime combines this Global Instruction with the current Node Instruction.">
              <button
                type="button"
                aria-label="Global Instruction information"
                className="rounded text-[var(--text-muted)] outline-none hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <CircleAlert className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          }
        >
          <DataReferenceInput
            id="base-instructions"
            value={config.baseInstructions}
            onChange={(value) => updateConfig({ baseInstructions: value })}
            suggestions={bindingSuggestions}
            multiline
            placeholder="Describe the global role and safety rules. Type @ to bind Data or State."
            className="min-h-64"
          />
        </Field>
      </div>
    );

  if (tab === "runtime")
    return (
      <div className="space-y-5">
        <Field label="Turn detection" htmlFor="vad-type">
          <Select
            id="vad-type"
            value={config.turnDetection.type}
            onChange={(event) => updateVad({ type: event.target.value as StartConfig["turnDetection"]["type"] })}
          >
            <option value="server_vad">Server VAD</option>
            <option value="semantic_vad">Semantic VAD</option>
          </Select>
        </Field>
        {config.turnDetection.type === "server_vad" ? (
          <>
            <Field label="Detection Threshold" htmlFor="vad-threshold">
              <div className="flex items-center gap-3">
                <input
                  id="vad-threshold"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.turnDetection.threshold}
                  onChange={(event) => updateVad({ threshold: Number(event.target.value) })}
                  className="min-w-0 flex-1 accent-[var(--blue)]"
                />
                <Badge>{config.turnDetection.threshold.toFixed(2)}</Badge>
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Prefix Padding" htmlFor="vad-prefix">
                <NumberInput
                  id="vad-prefix"
                  value={config.turnDetection.prefixPaddingMs}
                  min={0}
                  step={10}
                  suffix="ms"
                  onChange={(value) => updateVad({ prefixPaddingMs: value })}
                />
              </Field>
              <Field label="End Silence" htmlFor="vad-silence">
                <NumberInput
                  id="vad-silence"
                  value={config.turnDetection.silenceDurationMs}
                  min={100}
                  step={10}
                  suffix="ms"
                  onChange={(value) => updateVad({ silenceDurationMs: value })}
                />
              </Field>
            </div>
          </>
        ) : (
          <Field label="Response Eagerness" htmlFor="vad-eagerness">
            <Select
              id="vad-eagerness"
              value={config.turnDetection.eagerness}
              onChange={(event) =>
                updateVad({ eagerness: event.target.value as StartConfig["turnDetection"]["eagerness"] })
              }
            >
              <option value="low">Low · Wait longer</option>
              <option value="medium">Medium</option>
              <option value="high">High · Respond quickly</option>
              <option value="auto">Auto</option>
            </Select>
          </Field>
        )}
        <ToggleRow
          label="Interrupt on Speech"
          description="Cancel the active response when the user starts speaking."
          checked={config.turnDetection.interruptResponse}
          onChange={(checked) => updateVad({ interruptResponse: checked })}
        />
      </div>
    );

  return (
    <div className="space-y-5">
      <ToggleRow
        label="Input Transcription"
        description="Store the transcript in parallel with model responses."
        checked={config.transcription.enabled}
        onChange={(checked) => updateTranscription({ enabled: checked })}
      />
      {config.transcription.enabled && (
        <>
          <Field label="Transcription Model" htmlFor="transcription-model">
            <Select
              id="transcription-model"
              value={config.transcription.model}
              onChange={(event) =>
                updateTranscription({ model: event.target.value as StartConfig["transcription"]["model"] })
              }
            >
              <option value="gpt-transcribe">gpt-transcribe</option>
              <option value="gpt-live-transcribe">gpt-live-transcribe</option>
            </Select>
          </Field>
          <Field label="Expected Languages" htmlFor="transcription-language">
            <Input
              id="transcription-language"
              value={config.transcription.languages.join(", ")}
              onChange={(event) => updateTranscription({ languages: splitList(event.target.value) })}
              placeholder="ko, en"
            />
          </Field>
          <Field
            label="Transcription Keywords"
            htmlFor="transcription-keywords"
            labelActionPosition="adjacent"
            labelAction={<FieldHelp text="Separate organization names, assessments, and proper nouns with commas." />}
          >
            <Input
              id="transcription-keywords"
              value={config.transcription.keywords.join(", ")}
              onChange={(event) => updateTranscription({ keywords: splitList(event.target.value) })}
              placeholder="Seocho-gu, PHQ-2, mental health"
            />
          </Field>
          {config.transcription.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {config.transcription.keywords.map((keyword) => (
                <Badge key={keyword} tone="purple">
                  {keyword}
                </Badge>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NodeEditor({
  node,
  tab,
  tools,
  functions,
  bindingSuggestions,
  outgoingEdges,
  update,
  onSelectEdge,
}: {
  node: VoiceNode;
  tab: InspectorTab;
  tools: ToolDefinition[];
  functions: ServiceFunction[];
  bindingSuggestions: DataReferenceSuggestion[];
  outgoingEdges: VoiceEdge[];
  update: (patch: Partial<VoiceNodeData>) => void;
  onSelectEdge: (id: string) => void;
}) {
  const runtime = node.data.runtime!;
  const updateRuntime = (patch: Partial<typeof runtime>) =>
    update({
      runtime: { ...runtime, ...patch },
      ...(patch.responseMode ? { responseMode: patch.responseMode } : {}),
      ...(patch.toolChoice ? { toolChoice: patch.toolChoice } : {}),
    });

  if (tab === "content")
    return (
      <div className="space-y-5">
        <Field label="Node Name" htmlFor="node-name">
          <Input id="node-name" value={node.data.name} onChange={(event) => update({ name: event.target.value })} />
        </Field>
        <Field label="Description" htmlFor="node-description">
          <Input
            id="node-description"
            value={node.data.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </Field>
      </div>
    );
  if (tab === "instruction")
    return (
      <div className="space-y-5">
        <Field
          label="Instruction"
          htmlFor="node-instructions"
          labelActionPosition="adjacent"
          labelAction={<FieldHelp text="Used when this Node creates a model response." />}
        >
          <DataReferenceInput
            id="node-instructions"
            value={node.data.instructions}
            onChange={(value) => update({ instructions: value })}
            suggestions={bindingSuggestions}
            multiline
            placeholder="Describe this step. Type @ to bind Data or State."
            className="min-h-64"
          />
        </Field>
      </div>
    );
  if (tab === "runtime")
    return (
      <div className="space-y-5">
        <Field label="Response Creation" htmlFor="response-mode">
          <Select
            id="response-mode"
            value={runtime.responseMode}
            onChange={(event) => updateRuntime({ responseMode: event.target.value as typeof runtime.responseMode })}
          >
            <option value="manual">Manual</option>
            <option value="automatic">Auto</option>
            <option value="none">None</option>
          </Select>
        </Field>
        {runtime.responseMode === "automatic" && (
          <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-soft)] p-3.5">
            <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--amber)]">
              <Radio className="h-3.5 w-3.5" /> Wait for session.updated
            </div>
            <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-secondary)]">
              The Runtime must update instructions and tools before enabling VAD for this Node.
            </p>
          </div>
        )}
        <Field label="Output Modality" htmlFor="output-modalities">
          <Select
            id="output-modalities"
            value={runtime.outputModalities}
            onChange={(event) =>
              updateRuntime({ outputModalities: event.target.value as typeof runtime.outputModalities })
            }
          >
            <option value="audio">Audio</option>
            <option value="text">Text</option>
          </Select>
        </Field>
        {runtime.outputModalities === "text" && (
          <Field label="After Text Output" htmlFor="follow-up-audio">
            <Select
              id="follow-up-audio"
              value={runtime.followUpAudio ? "yes" : "no"}
              onChange={(event) => updateRuntime({ followUpAudio: event.target.value === "yes" })}
            >
              <option value="yes">Create Audio Response</option>
              <option value="no">None</option>
            </Select>
          </Field>
        )}
        <Field label="Tool Choice" htmlFor="tool-choice">
          <Select
            id="tool-choice"
            value={runtime.toolChoice}
            onChange={(event) => {
              const toolChoice = event.target.value as typeof runtime.toolChoice;
              updateRuntime({ toolChoice, ...(toolChoice === "none" ? { parallelToolCalls: false } : {}) });
            }}
          >
            <option value="none">None</option>
            <option value="auto">Auto</option>
            <option value="required">Required</option>
          </Select>
        </Field>
        {runtime.toolChoice !== "none" && (
          <ToggleRow
            label="Parallel Tool Calls"
            checked={runtime.parallelToolCalls}
            onChange={(checked) => updateRuntime({ parallelToolCalls: checked })}
          />
        )}
        <Field label="Max Output Tokens" htmlFor="max-tokens">
          <NumberInput
            id="max-tokens"
            value={runtime.maxOutputTokens}
            min={1}
            max={4096}
            step={64}
            suffix="tokens"
            onChange={(value) => updateRuntime({ maxOutputTokens: value })}
          />
        </Field>
      </div>
    );
  if (tab === "tools")
    return (
      <ToolSelection
        tools={tools}
        functions={functions}
        bindingSuggestions={bindingSuggestions}
        selected={node.data.toolIds}
        inputBindings={node.data.toolInputBindings ?? []}
        functionBindings={node.data.toolFunctionBindings ?? []}
        onChange={(toolIds, toolInputBindings, toolFunctionBindings) =>
          update({ toolIds, toolInputBindings, toolFunctionBindings })
        }
      />
    );
  return <RouteList edges={outgoingEdges} onSelect={onSelectEdge} />;
}

function ToolEditor({
  node,
  tab,
  tools,
  outgoingEdges,
  update,
  onSelectEdge,
}: {
  node: VoiceNode;
  tab: InspectorTab;
  tools: ToolDefinition[];
  outgoingEdges: VoiceEdge[];
  update: (patch: Partial<VoiceNodeData>) => void;
  onSelectEdge: (id: string) => void;
}) {
  const config = node.data.toolConfig!;
  const selectedTool = tools.find((tool) => tool.id === config.toolId);
  if (tab === "content")
    return (
      <div className="space-y-5">
        <Notice
          icon={<Wrench className="h-3.5 w-3.5" />}
          title="Deterministic Runtime Action"
          text="Run the selected Tool whenever the Flow reaches this block."
        />
        <Field label="Block Name" htmlFor="tool-node-name">
          <Input
            id="tool-node-name"
            value={node.data.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <Field label="Description" htmlFor="tool-node-description">
          <Input
            id="tool-node-description"
            value={node.data.description}
            onChange={(event) => update({ description: event.target.value })}
          />
        </Field>
      </div>
    );
  if (tab === "runtime")
    return (
      <div className="space-y-5">
        <Field
          label="Realtime Tool"
          htmlFor="tool-block-select"
          labelActionPosition="adjacent"
          labelAction={<FieldHelp text="Select the function schema exposed to GPT Realtime." />}
        >
          <Select
            id="tool-block-select"
            value={config.toolId}
            onChange={(event) =>
              update({
                toolConfig: { ...config, toolId: event.target.value },
                toolIds: event.target.value ? [event.target.value] : [],
              })
            }
          >
            <option value="">Select a Tool</option>
            {tools.map((tool) => (
              <option key={tool.id} value={tool.id}>
                {tool.displayName}
              </option>
            ))}
          </Select>
        </Field>
        {selectedTool && (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[9px] text-[var(--blue)]">{selectedTool.name}</span>
              <Badge>{selectedTool.parameters.length} parameters</Badge>
            </div>
            <p className="mt-2 text-[9px] leading-4 text-[var(--text-muted)]">{selectedTool.description}</p>
          </div>
        )}
        <Notice
          icon={<Wrench className="h-3.5 w-3.5" />}
          title="Function binding comes next"
          text="This block currently selects the Realtime Tool contract. Service execution will be connected from the Functions page."
        />
      </div>
    );
  return <RouteList edges={outgoingEdges} onSelect={onSelectEdge} />;
}

function EndEditor({ node, update }: { node: VoiceNode; update: (patch: Partial<VoiceNodeData>) => void }) {
  const config = node.data.endConfig!;
  const updateEnd = (patch: Partial<EndConfig>) => update({ endConfig: { ...config, ...patch } });
  return (
    <div className="space-y-5">
      <Field label="Block Name" htmlFor="end-name">
        <Input id="end-name" value={node.data.name} onChange={(event) => update({ name: event.target.value })} />
      </Field>
      <Field
        label="Final Message"
        htmlFor="end-message"
        labelActionPosition="adjacent"
        labelAction={<FieldHelp text="Leave empty when the preceding Node already says goodbye." />}
      >
        <Textarea
          id="end-message"
          value={config.finalMessage}
          onChange={(event) => updateEnd({ finalMessage: event.target.value })}
        />
      </Field>
      <div className="h-px bg-[var(--border)]" />
      <ToggleRow
        label="Save Transcript"
        description="Preserve the call history after the call ends."
        checked={config.saveTranscript}
        onChange={(checked) => updateEnd({ saveTranscript: checked })}
      />
    </div>
  );
}

function EdgeInspector({
  edge,
  stateSchema,
  inspectorWidth,
  onResizeStart,
  onResizeKeyDown,
  onCollapse,
  onUpdate,
  onDelete,
}: {
  edge: VoiceEdge;
  stateSchema: StateSchema | null;
  inspectorWidth: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onCollapse: () => void;
  onUpdate: (patch: Partial<RouteData>) => void;
  onDelete: () => void;
}) {
  const data = edge.data!;
  const rules = data.condition?.rules ?? [];
  const stateSuggestions = (stateSchema ? listStateReferenceSuggestions([stateSchema]) : []).sort(
    (left, right) => Number(left.expression.includes(".system.")) - Number(right.expression.includes(".system.")),
  );
  const variableOptions = Array.from(
    new Set([
      ...stateSuggestions.map((suggestion) => suggestion.expression),
      ...rules.map((rule) => rule.path).filter(Boolean),
    ]),
  );
  const updateRule = (id: string, patch: Partial<ConditionRule>) =>
    onUpdate({
      condition: {
        logic: data.condition?.logic ?? "all",
        rules: rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
      },
    });
  const addRule = () =>
    onUpdate({
      condition: {
        logic: data.condition?.logic ?? "all",
        rules: [
          ...rules,
          {
            id: `rule-${Date.now().toString(36)}`,
            kind: "state",
            path: variableOptions[0] ?? "",
            comparator: "equals",
            value: "",
          },
        ],
      },
    });
  const updateRuleInput = (rule: ConditionRule, value: string) =>
    updateRule(
      rule.id,
      value === "__timeout__"
        ? { kind: "timeout", path: "", timeoutMs: rule.timeoutMs ?? 15000 }
        : { kind: "state", path: value },
    );
  const removeRule = (id: string) =>
    onUpdate({ condition: { logic: data.condition?.logic ?? "all", rules: rules.filter((rule) => rule.id !== id) } });
  return (
    <InspectorAside
      width={inspectorWidth}
      onResizeStart={onResizeStart}
      onResizeKeyDown={onResizeKeyDown}
      onCollapse={onCollapse}
    >
      <div className="border-b border-[var(--border)] px-5 pb-0 pt-4">
        <div className="flex items-center gap-2">
          <Badge tone="amber">EDGE</Badge>
          <h2 className="truncate text-sm font-bold text-[var(--text)]" title={data.name}>
            {data.name}
          </h2>
        </div>
        <div className="mt-4 flex gap-1" role="tablist" aria-label="Edge settings">
          <button
            type="button"
            role="tab"
            aria-selected="true"
            className="shrink-0 cursor-default border-b-2 border-[var(--blue)] px-2.5 pb-3 text-[10px] font-semibold text-[var(--blue)]"
          >
            Base
          </button>
        </div>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        <Field label="Name" htmlFor="edge-name">
          <Input id="edge-name" value={data.name} onChange={(event) => onUpdate({ name: event.target.value })} />
        </Field>
        <div className={cn("grid gap-3", data.routeType === "condition" ? "grid-cols-2" : "grid-cols-1")}>
          <Field label="Type" htmlFor="route-type">
            <Select
              id="route-type"
              value={data.routeType === "timeout" ? "condition" : data.routeType}
              onChange={(event) => onUpdate({ routeType: event.target.value as RouteData["routeType"] })}
            >
              <option value="always">Always</option>
              <option value="condition">Condition</option>
              <option value="fallback">Fallback</option>
            </Select>
          </Field>
          {data.routeType === "condition" && (
            <Field label="Logic" htmlFor="condition-logic">
              <Select
                id="condition-logic"
                value={data.condition?.logic ?? "all"}
                onChange={(event) => onUpdate({ condition: { logic: event.target.value as "all" | "any", rules } })}
              >
                <option value="all">AND</option>
                <option value="any">OR</option>
              </Select>
            </Field>
          )}
        </div>
        {data.routeType === "condition" && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--text-secondary)]">
              <span>Conditions</span>
              <FieldHelp text="Choose a State field and comparison, or select Timeout. AND requires every condition; OR continues when any condition matches." />
            </div>
            <div className="divide-y divide-[var(--border)] border-b border-[var(--border)]">
              {rules.map((rule, index) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-[minmax(0,1.25fr)_132px_minmax(0,0.75fr)_28px] items-center gap-2 py-2.5"
                >
                  <Select
                    aria-label={`Condition ${index + 1} input`}
                    value={rule.kind === "timeout" ? "__timeout__" : rule.path}
                    onChange={(event) => updateRuleInput(rule, event.target.value)}
                  >
                    <optgroup label="Runtime">
                      <option value="__timeout__">Timeout</option>
                    </optgroup>
                    <optgroup label="State">
                      {variableOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </optgroup>
                  </Select>
                  {rule.kind === "timeout" ? (
                    <>
                      <NumberInput
                        id={`condition-timeout-${edge.id}-${rule.id}`}
                        aria-label={`Condition ${index + 1} timeout duration`}
                        value={rule.timeoutMs ?? 15000}
                        min={1000}
                        step={1000}
                        suffix="ms"
                        onChange={(value) => updateRule(rule.id, { timeoutMs: value })}
                      />
                      <span />
                    </>
                  ) : (
                    <>
                      <Select
                        aria-label={`Condition ${index + 1} operator`}
                        value={rule.comparator}
                        onChange={(event) =>
                          updateRule(rule.id, { comparator: event.target.value as ConditionComparator })
                        }
                      >
                        <option value="equals">Equals</option>
                        <option value="not_equals">Not equal</option>
                        <option value="contains">Contains</option>
                        <option value="greater_than">Greater than</option>
                        <option value="greater_or_equal">At least</option>
                        <option value="less_than">Less than</option>
                        <option value="less_or_equal">At most</option>
                      </Select>
                      <Input
                        aria-label={`Condition ${index + 1} value`}
                        value={rule.value}
                        onChange={(event) => updateRule(rule.id, { value: event.target.value })}
                        placeholder="Value"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--red-soft)] hover:text-[var(--red)]"
                    onClick={() => removeRule(rule.id)}
                    aria-label={`Delete condition ${index + 1}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-full border border-dashed border-[var(--border-strong)]"
              onClick={addRule}
            >
              <Plus className="h-3.5 w-3.5" /> Add Condition
            </Button>
          </div>
        )}
        {data.routeType === "fallback" && (
          <div className="rounded-xl border border-[var(--amber-border)] bg-[var(--amber-soft)] p-3.5 text-[10px] leading-5 text-[var(--text-secondary)]">
            Default route when no preceding condition matches. Use one Fallback Edge for each Node with conditional
            Edges.
          </div>
        )}
      </div>
      <div className="border-t border-[var(--border)] p-4">
        <Button variant="danger" size="sm" className="w-full" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete Edge
        </Button>
      </div>
    </InspectorAside>
  );
}

function toolArgumentSuggestions(tool: ToolDefinition): DataReferenceSuggestion[] {
  return tool.parameters.map((parameter) => ({
    expression: `@tool.arguments.${parameter.name}`,
    reference: { kind: "tool" as const, toolId: tool.id, path: parameter.name },
    values: (parameter.enumValues ?? []).filter(
      (value): value is string | number => typeof value === "string" || typeof value === "number",
    ),
    dataName: "Tool Arguments",
    dataDescription: `Arguments received from ${tool.displayName}.`,
    sourceKind: "tool" as const,
    valueType: parameter.type,
    hint: `${parameter.name} · ${parameter.type}`,
  }));
}

function defaultFunctionInputMappings(tool: ToolDefinition, serviceFunction: ServiceFunction) {
  const toolArgumentNames = new Set(tool.parameters.map((parameter) => parameter.name));
  return serviceFunction.inputs
    .filter((input) => toolArgumentNames.has(input.name))
    .map((input) => ({ inputName: input.name, value: `@tool.arguments.${input.name}` }));
}

function ToolSelection({
  tools,
  functions,
  bindingSuggestions,
  selected,
  inputBindings,
  functionBindings,
  onChange,
}: {
  tools: ToolDefinition[];
  functions: ServiceFunction[];
  bindingSuggestions: DataReferenceSuggestion[];
  selected: string[];
  inputBindings: ToolInputBinding[];
  functionBindings: ToolFunctionBinding[];
  onChange: (ids: string[], inputBindings: ToolInputBinding[], functionBindings: ToolFunctionBinding[]) => void;
}) {
  const toggleTool = (toolId: string) => {
    const checked = selected.includes(toolId);
    const tool = tools.find((candidate) => candidate.id === toolId);
    onChange(
      checked ? selected.filter((id) => id !== toolId) : [...selected, toolId],
      checked
        ? inputBindings.filter((binding) => binding.toolId !== toolId)
        : tool?.inputs?.length
          ? [...inputBindings, { toolId, inputMappings: [] }]
          : inputBindings,
      checked ? functionBindings.filter((binding) => binding.toolId !== toolId) : functionBindings,
    );
  };
  const bindFunction = (toolId: string, functionId: string) => {
    const remaining = functionBindings.filter((binding) => binding.toolId !== toolId);
    const tool = tools.find((candidate) => candidate.id === toolId);
    const serviceFunction = functions.find((candidate) => candidate.id === functionId);
    onChange(
      selected,
      inputBindings,
      tool && serviceFunction
        ? [...remaining, { toolId, functionId, inputMappings: defaultFunctionInputMappings(tool, serviceFunction) }]
        : remaining,
    );
  };
  const updateInputMapping = (toolId: string, inputName: string, value: string) => {
    onChange(
      selected,
      inputBindings,
      functionBindings.map((binding) => {
        if (binding.toolId !== toolId) return binding;
        const remaining = binding.inputMappings.filter((mapping) => mapping.inputName !== inputName);
        return { ...binding, inputMappings: value.trim() ? [...remaining, { inputName, value }] : remaining };
      }),
    );
  };
  const updateToolInputMapping = (toolId: string, inputName: string, value: string) => {
    const existing = inputBindings.find((binding) => binding.toolId === toolId) ?? { toolId, inputMappings: [] };
    const remainingBindings = inputBindings.filter((binding) => binding.toolId !== toolId);
    const remainingMappings = existing.inputMappings.filter((mapping) => mapping.inputName !== inputName);
    onChange(
      selected,
      [
        ...remainingBindings,
        { ...existing, inputMappings: value.trim() ? [...remainingMappings, { inputName, value }] : remainingMappings },
      ],
      functionBindings,
    );
  };
  return (
    <div className="space-y-2">
      {tools.map((tool) => {
        const checked = selected.includes(tool.id);
        const toolInputBinding = inputBindings.find((candidate) => candidate.toolId === tool.id);
        const binding = functionBindings.find((candidate) => candidate.toolId === tool.id);
        const serviceFunction = functions.find((candidate) => candidate.id === binding?.functionId);
        const suggestions = [...toolArgumentSuggestions(tool), ...bindingSuggestions];
        return (
          <div
            key={tool.id}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              checked
                ? "border-[var(--purple-border)] bg-[var(--purple-soft)]"
                : "border-[var(--border)] hover:bg-[var(--surface-hover)]",
            )}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTool(tool.id)}
                className="mt-0.5 accent-[var(--purple)]"
              />
              <span className="min-w-0">
                <span className="block text-[11px] font-bold text-[var(--text)]">{tool.displayName}</span>
                <span className="mt-1 block text-[9px] leading-4 text-[var(--text-muted)]">{tool.description}</span>
              </span>
            </label>
            {checked && (
              <div className="mt-3 border-t border-[var(--purple-border)] pt-3">
                {(tool.inputs ?? []).length > 0 && (
                  <div className="mb-4">
                    <div className="mb-1 text-[10px] font-semibold text-[var(--text-secondary)]">Inputs</div>
                    <div className="divide-y divide-[var(--purple-border)]">
                      {(tool.inputs ?? []).map((input) => {
                        const mapping =
                          toolInputBinding?.inputMappings.find((candidate) => candidate.inputName === input.name)
                            ?.value ?? "";
                        return (
                          <div
                            key={input.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,1.25fr)] items-center gap-2.5 py-2.5"
                          >
                            <span className="flex min-w-0 items-center gap-1.5 pl-2">
                              <span
                                className="min-w-0 truncate font-mono text-[10px] font-semibold text-[var(--text)]"
                                title={input.name}
                              >
                                {input.name}
                              </span>
                              <Badge className="h-5 shrink-0 px-1.5 text-[9px]">{input.type}</Badge>
                            </span>
                            <DataReferenceInput
                              aria-label={`${input.name} Tool input value`}
                              value={mapping}
                              onChange={(value) => updateToolInputMapping(tool.id, input.name, value)}
                              suggestions={bindingSuggestions}
                              placeholder="@ reference or literal"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <Field label="Function" htmlFor={`tool-function-${tool.id}`}>
                  <Select
                    id={`tool-function-${tool.id}`}
                    value={binding?.functionId ?? ""}
                    onChange={(event) => bindFunction(tool.id, event.target.value)}
                  >
                    <option value="">None</option>
                    {functions.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                {binding && serviceFunction && serviceFunction.inputs.length > 0 && (
                  <div className="mt-4 border-t border-[var(--purple-border)] pt-3">
                    <div className="mb-1 text-[10px] font-semibold text-[var(--text-secondary)]">Parameter</div>
                    <div className="divide-y divide-[var(--purple-border)]">
                      {serviceFunction.inputs.map((input) => {
                        const mapping =
                          binding.inputMappings.find((candidate) => candidate.inputName === input.name)?.value ?? "";
                        return (
                          <div
                            key={input.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,1.25fr)] items-center gap-2.5 py-2.5"
                          >
                            <span className="flex min-w-0 items-center gap-1.5 pl-2">
                              <span
                                className="min-w-0 truncate font-mono text-[10px] font-semibold text-[var(--text)]"
                                title={input.name}
                              >
                                {input.name}
                              </span>
                              <Badge className="h-5 shrink-0 px-1.5 text-[9px]">{input.type}</Badge>
                            </span>
                            <DataReferenceInput
                              aria-label={`${input.name} input value`}
                              value={mapping}
                              onChange={(value) => updateInputMapping(tool.id, input.name, value)}
                              suggestions={suggestions}
                              placeholder="@ reference or literal"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RouteList({ edges, onSelect }: { edges: VoiceEdge[]; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {edges.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border-strong)] px-4 py-8 text-center text-[10px] text-[var(--text-muted)]">
          No outgoing Edges yet.
        </div>
      ) : (
        [...edges]
          .sort((a, b) => (a.data?.priority ?? 0) - (b.data?.priority ?? 0))
          .map((edge) => (
            <button
              key={edge.id}
              onClick={() => onSelect(edge.id)}
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3 text-left outline-none hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            >
              <GitBranch className="h-4 w-4 text-[var(--amber)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-bold text-[var(--text)]">{edge.data?.name}</span>
                <span className="mt-1 block font-mono text-[9px] capitalize text-[var(--text-muted)]">
                  {edge.data?.routeType}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            </button>
          ))
      )}
    </div>
  );
}

function clampInspectorWidth(width: number) {
  const viewportMaximum =
    typeof window === "undefined" ? MAX_INSPECTOR_WIDTH : Math.max(MIN_INSPECTOR_WIDTH, window.innerWidth * 0.5);
  return Math.round(Math.min(Math.max(width, MIN_INSPECTOR_WIDTH), Math.min(MAX_INSPECTOR_WIDTH, viewportMaximum)));
}

function readInspectorWidth() {
  if (typeof window === "undefined") return DEFAULT_INSPECTOR_WIDTH;
  try {
    const storedWidth = Number(window.localStorage.getItem(INSPECTOR_WIDTH_KEY));
    return Number.isFinite(storedWidth) && storedWidth > 0 ? clampInspectorWidth(storedWidth) : DEFAULT_INSPECTOR_WIDTH;
  } catch {
    return DEFAULT_INSPECTOR_WIDTH;
  }
}

function saveInspectorWidth(width: number) {
  try {
    window.localStorage.setItem(INSPECTOR_WIDTH_KEY, String(width));
  } catch {
    // The Inspector remains resizable when browser storage is unavailable.
  }
}

function readInspectorCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(INSPECTOR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function saveInspectorCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(INSPECTOR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // The current session still supports collapsing when browser storage is unavailable.
  }
}

function useInspectorResize() {
  const [width, setWidth] = useState(readInspectorWidth);
  const widthRef = useRef(width);
  const stopResizeRef = useRef<(() => void) | null>(null);

  const updateWidth = useCallback((nextWidth: number, persist = false) => {
    const clampedWidth = clampInspectorWidth(nextWidth);
    widthRef.current = clampedWidth;
    setWidth(clampedWidth);
    if (persist) saveInspectorWidth(clampedWidth);
  }, []);

  const beginResize = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      stopResizeRef.current?.();

      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const handlePointerMove = (pointerEvent: PointerEvent) => updateWidth(window.innerWidth - pointerEvent.clientX);
      const stopResize = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        saveInspectorWidth(widthRef.current);
        stopResizeRef.current = null;
      };

      stopResizeRef.current = stopResize;
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [updateWidth],
  );

  const resizeWithKeyboard = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      updateWidth(widthRef.current + (event.key === "ArrowLeft" ? 16 : -16), true);
    },
    [updateWidth],
  );

  useEffect(() => () => stopResizeRef.current?.(), []);

  return { width, beginResize, resizeWithKeyboard };
}

function InspectorAside({
  width,
  onResizeStart,
  onResizeKeyDown,
  onCollapse,
  children,
}: {
  width: number;
  onResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void;
  onResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onCollapse: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)] max-lg:hidden"
    >
      <Tooltip content="Collapse Inspector">
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse Inspector"
          aria-expanded="true"
          className="absolute -left-3 top-5 z-30 hidden h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-sm outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] lg:flex"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
      <div
        role="separator"
        aria-label="Resize Inspector"
        aria-orientation="vertical"
        aria-valuemin={MIN_INSPECTOR_WIDTH}
        aria-valuemax={MAX_INSPECTOR_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
        className="group absolute -left-1.5 top-0 z-20 h-full w-3 touch-none cursor-col-resize outline-none"
      >
        <span className="absolute left-1/2 top-1/2 h-10 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--border-strong)] opacity-60 transition-all group-hover:h-14 group-hover:bg-[var(--blue)] group-hover:opacity-100 group-focus-visible:h-14 group-focus-visible:bg-[var(--blue)] group-focus-visible:opacity-100" />
      </div>
      {children}
    </aside>
  );
}

function CollapsedInspectorButton({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="relative w-0 shrink-0 max-lg:hidden">
      <Tooltip content="Expand Inspector">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand Inspector"
          aria-expanded="false"
          className="absolute right-3 top-5 z-30 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] shadow-sm outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </div>
  );
}

function FieldHelp({ text }: { text: string }) {
  return (
    <Tooltip content={text}>
      <button
        type="button"
        aria-label="More information"
        className="rounded text-[var(--text-muted)] outline-none hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
    </Tooltip>
  );
}

function Notice({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-[var(--blue-border)] bg-[var(--blue-soft)] p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-bold text-[var(--blue)]">
        {icon}
        {title}
      </div>
      <p className="mt-1.5 text-[9px] leading-4 text-[var(--text-secondary)]">{text}</p>
    </div>
  );
}
function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className={cn("font-mono", suffix && "pr-14")}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-[var(--text-muted)]">
          {suffix}
        </span>
      )}
    </div>
  );
}
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-[var(--border)] p-3.5">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold text-[var(--text)]">{label}</span>
        {description && <span className="mt-1 block text-[9px] leading-4 text-[var(--text-muted)]">{description}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--blue)]"
      />
    </label>
  );
}
function splitList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
