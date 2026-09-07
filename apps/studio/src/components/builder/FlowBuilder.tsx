import {
  Background,
  BackgroundVariant,
  Controls,
  ConnectionMode,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  reconnectEdge,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  LockKeyhole,
  Rocket,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { defaultEndConfig, defaultStartConfig, createNodeData } from "../../domain/defaults";
import type { FlowDocument, RouteData, ToolDefinition, VoiceEdge, VoiceNode, VoiceNodeData } from "../../domain/flow";
import type { DataAsset } from "../../domain/workspaces";
import type { StateSchema } from "../../domain/state";
import type { ServiceFunction } from "../../domain/functions";
import { listDataReferenceSuggestions } from "../../domain/dataReferences";
import { listStateReferenceSuggestions } from "../../domain/stateReferences";
import { serializeFlow } from "../../domain/serialize";
import { createNodeId } from "../../domain/nodeIds";
import { validateFlow } from "../../domain/validation";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Tooltip } from "../ui/Tooltip";
import { Inspector } from "./Inspector";
import { NodePalette, type NodeTemplate } from "./NodePalette";
import { ValidationConsole } from "./ValidationConsole";
import { VoiceFlowNode } from "./VoiceFlowNode";

const nodeTypes = { voiceNode: VoiceFlowNode };

function flowFingerprint(flow: FlowDocument) {
  const { updated_at: _updatedAt, ...content } = serializeFlow(flow, { version: 0, status: "draft" });
  return JSON.stringify(content);
}

function dataFromTemplate(template: NodeTemplate): VoiceNodeData {
  if (template.kind === "start")
    return {
      kind: "start",
      name: "Start",
      description: "Connect Twilio Media Streams and the Realtime session.",
      objective: "Prepare the call.",
      instructions: "",
      responseMode: "none",
      toolIds: [],
      toolChoice: "none",
      startConfig: structuredClone(defaultStartConfig),
      health: "ready",
    };
  if (template.kind === "end")
    return {
      kind: "end",
      name: "End",
      description: "End the call after final playback completes.",
      objective: "Terminate the call safely.",
      instructions: "",
      responseMode: "none",
      toolIds: [],
      toolChoice: "none",
      endConfig: structuredClone(defaultEndConfig),
      health: "ready",
    };
  return createNodeData();
}

export function FlowBuilder({
  flow: savedFlow,
  tools,
  functions,
  dataAssets,
  stateSchemas,
  dark,
  onSave,
  onBack,
  onPublish,
}: {
  flow: FlowDocument;
  tools: ToolDefinition[];
  functions: ServiceFunction[];
  dataAssets: DataAsset[];
  stateSchemas: StateSchema[];
  dark: boolean;
  onSave: (flow: FlowDocument) => void;
  onBack: () => void;
  onPublish: () => void;
}) {
  const { screenToFlowPosition, fitView } = useReactFlow<VoiceNode, VoiceEdge>();
  const [flow, setFlow] = useState<FlowDocument>(() => structuredClone(savedFlow));
  const [savedSnapshot, setSavedSnapshot] = useState<FlowDocument>(() => structuredClone(savedFlow));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(flow.entryNodeId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [pendingDeleteNodeId, setPendingDeleteNodeId] = useState<string | null>(null);
  const [discardAction, setDiscardAction] = useState<"revert" | "leave" | null>(null);

  const isDirty = useMemo(() => flowFingerprint(flow) !== flowFingerprint(savedSnapshot), [flow, savedSnapshot]);
  const issues = useMemo(
    () => validateFlow(flow, stateSchemas, functions, tools),
    [flow, functions, stateSchemas, tools],
  );
  const selectedStateSchema = useMemo(
    () => stateSchemas.find((schema) => schema.id === flow.stateSchemaId) ?? null,
    [flow.stateSchemaId, stateSchemas],
  );
  const bindingSuggestions = useMemo(
    () => [
      ...listDataReferenceSuggestions(dataAssets),
      ...listStateReferenceSuggestions(selectedStateSchema ? [selectedStateSchema] : []),
    ],
    [dataAssets, selectedStateSchema],
  );
  const selectedNode = flow.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = flow.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const pendingDeleteNode = flow.nodes.find((node) => node.id === pendingDeleteNodeId) ?? null;
  const pendingDeleteEdgeCount = pendingDeleteNode
    ? flow.edges.filter((edge) => edge.source === pendingDeleteNode.id || edge.target === pendingDeleteNode.id).length
    : 0;
  const renderedNodes = useMemo(() => {
    const availableToolIds = new Set(tools.map((tool) => tool.id));
    const nodeIds = new Set(flow.nodes.map((node) => node.id));
    return flow.nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        availableToolCount: node.data.toolIds.filter((toolId) => availableToolIds.has(toolId)).length,
        outgoingEdgeCount: flow.edges.filter((edge) => edge.source === node.id && nodeIds.has(edge.target)).length,
        ...(node.data.kind === "start" ? { stateSchemaName: selectedStateSchema?.name ?? "No State" } : {}),
      },
    }));
  }, [flow.edges, flow.nodes, selectedNodeId, selectedStateSchema?.name, tools]);
  const renderedEdges = useMemo(
    () =>
      flow.edges.map((edge) => {
        const selected = edge.id === selectedEdgeId;
        const color = selected ? "var(--blue)" : "var(--edge)";
        const markerColor = selected ? (dark ? "#60a5fa" : "#2563eb") : dark ? "#64748b" : "#94a3b8";
        return {
          ...edge,
          selected,
          reconnectable: selected,
          label: edge.data?.name,
          style: { stroke: color, strokeWidth: selected ? 2.5 : 1.5 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: markerColor,
            width: 17,
            height: 17,
          },
        };
      }),
    [dark, flow.edges, selectedEdgeId],
  );

  useEffect(() => {
    const nextFlow = structuredClone(savedFlow);
    setFlow(nextFlow);
    setSavedSnapshot(structuredClone(nextFlow));
  }, [savedFlow]);

  useEffect(() => {
    setSelectedNodeId(flow.entryNodeId);
    setSelectedEdgeId(null);
  }, [flow.id, flow.entryNodeId]);
  const commit = (patch: Partial<FlowDocument>) =>
    setFlow((current) => ({ ...current, ...patch, updatedAt: new Date().toISOString() }));

  const saveFlow = () => {
    if (!isDirty) return;
    const nextFlow = { ...flow, updatedAt: new Date().toISOString() };
    setFlow(nextFlow);
    setSavedSnapshot(structuredClone(nextFlow));
    onSave(nextFlow);
  };

  const confirmDiscard = () => {
    if (!discardAction) return;
    if (discardAction === "revert") {
      const restored = structuredClone(savedSnapshot);
      setFlow(restored);
      setSelectedNodeId(restored.entryNodeId);
      setSelectedEdgeId(null);
      setDiscardAction(null);
      return;
    }
    setDiscardAction(null);
    onBack();
  };

  const requestBack = () => {
    if (isDirty) {
      setDiscardAction("leave");
      return;
    }
    onBack();
  };

  const onNodesChange = (changes: NodeChange<VoiceNode>[]) => {
    const safeChanges = changes.filter(
      (change) =>
        change.type !== "select" &&
        change.type !== "dimensions" &&
        (change.type !== "remove" || change.id !== flow.entryNodeId),
    );
    if (safeChanges.length === 0) return;
    const removed = new Set(safeChanges.filter((change) => change.type === "remove").map((change) => change.id));
    commit({
      nodes: applyNodeChanges(safeChanges, flow.nodes),
      edges: removed.size
        ? flow.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target))
        : flow.edges,
    });
  };
  const onEdgesChange = (changes: EdgeChange<VoiceEdge>[]) => {
    const meaningfulChanges = changes.filter((change) => change.type !== "select");
    if (meaningfulChanges.length === 0) return;
    commit({ edges: applyEdgeChanges(meaningfulChanges, flow.edges) });
  };
  const isValidConnection = (connection: Connection | VoiceEdge) => {
    if (connection.source === connection.target) return false;
    const source = flow.nodes.find((node) => node.id === connection.source);
    const target = flow.nodes.find((node) => node.id === connection.target);
    return source?.data.kind !== "end" && target?.data.kind !== "start";
  };
  const onConnect = (connection: Connection) => {
    const priority = flow.edges.filter((edge) => edge.source === connection.source).length + 1;
    const edge: VoiceEdge = {
      ...connection,
      id: `edge-${connection.source}-${connection.target}-${Date.now()}`,
      type: "smoothstep",
      data: { name: "Next", routeType: "always", priority },
    };
    commit({ edges: addEdge(edge, flow.edges) });
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  };
  const onReconnect = (edge: VoiceEdge, connection: Connection) => {
    commit({
      edges: reconnectEdge(edge, connection, flow.edges, {
        shouldReplaceId: false,
      }),
    });
    setSelectedNodeId(null);
    setSelectedEdgeId(edge.id);
  };

  const createNode = (template: NodeTemplate, position?: { x: number; y: number }) => {
    if (template.kind === "start" && flow.nodes.some((node) => node.data.kind === "start")) {
      setSelectedNodeId(flow.entryNodeId);
      setSelectedEdgeId(null);
      return;
    }
    const id = createNodeId(template.kind);
    const newNode: VoiceNode = {
      id,
      type: "voiceNode",
      position: position ?? { x: 520 + Math.random() * 80, y: 180 + Math.random() * 120 },
      data: dataFromTemplate(template),
    };
    commit({ nodes: [...flow.nodes, newNode] });
    setSelectedNodeId(id);
    setSelectedEdgeId(null);
  };
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    try {
      const template = JSON.parse(event.dataTransfer.getData("application/relay-node")) as NodeTemplate;
      if (template.kind) createNode(template, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    } catch {
      /* Ignore drops from unrelated sources. */
    }
  };
  const updateNode = (nodeId: string, patch: Partial<VoiceNodeData>) =>
    commit({
      nodes: flow.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const data = { ...node.data, ...patch };
        const runtime = data.runtime;
        const needsReview =
          data.kind === "node" &&
          ((runtime?.responseMode !== "none" && !data.instructions.trim()) ||
            (runtime?.toolChoice === "required" && data.toolIds.length === 0));
        return { ...node, data: { ...data, health: needsReview ? "warning" : data.health } };
      }),
    });
  const updateEdge = (edgeId: string, patch: Partial<RouteData>) =>
    commit({
      edges: flow.edges.map((edge) =>
        edge.id === edgeId
          ? { ...edge, data: { name: "Next", routeType: "always", priority: 1, ...edge.data, ...patch } }
          : edge,
      ),
    });
  const deleteEdge = (edgeId: string) => {
    commit({ edges: flow.edges.filter((edge) => edge.id !== edgeId) });
    setSelectedEdgeId(null);
  };
  const requestDeleteNode = (nodeId: string) => {
    if (nodeId !== flow.entryNodeId) setPendingDeleteNodeId(nodeId);
  };
  const confirmDeleteNode = () => {
    if (!pendingDeleteNode || pendingDeleteNode.id === flow.entryNodeId) return;
    commit({
      nodes: flow.nodes.filter((node) => node.id !== pendingDeleteNode.id),
      edges: flow.edges.filter((edge) => edge.source !== pendingDeleteNode.id && edge.target !== pendingDeleteNode.id),
    });
    setSelectedNodeId(null);
    setPendingDeleteNodeId(null);
  };

  useEffect(() => {
    const handleDelete = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveFlow();
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName ?? "")) return;
      if (pendingDeleteNodeId) return;
      if (selectedEdgeId) {
        event.preventDefault();
        deleteEdge(selectedEdgeId);
        return;
      }
      if (selectedNodeId && selectedNodeId !== flow.entryNodeId) {
        event.preventDefault();
        requestDeleteNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", handleDelete);
    return () => window.removeEventListener("keydown", handleDelete);
  }, [flow, isDirty, pendingDeleteNodeId, savedSnapshot, selectedEdgeId, selectedNodeId]);

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const openValidation = () => setConsoleOpen(true);
  const exportFlow = () => {
    const payload = serializeFlow(flow, { version: flow.version + 1, status: "draft" });
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${flow.id}.flow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const selectStart = () => {
    setSelectedNodeId(flow.entryNodeId);
    setSelectedEdgeId(null);
  };

  return (
    <main id="main-content" className="flex min-h-0 flex-1 flex-col bg-[var(--app-bg)]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4">
        <div className="flex items-center gap-2">
          <Tooltip content="Back to Agents">
            <Button variant="ghost" size="icon" onClick={requestBack} aria-label="Back to Agents">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Badge tone={isDirty ? "amber" : "green"} dot>
            {isDirty ? "Unsaved changes" : "Saved"}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Tooltip content="Start settings">
            <Button variant="ghost" size="icon" onClick={selectStart} aria-label="Open Start settings">
              <Settings2 className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Button variant="secondary" size="sm" onClick={openValidation}>
            {issues.length === 0 ? (
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--green)]" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Validate{" "}
            {issues.length > 0 && (
              <span className="rounded bg-[var(--red-soft)] px-1 text-[var(--red)]">{issues.length}</span>
            )}
          </Button>
          <Button variant="secondary" size="sm" onClick={saveFlow} disabled={!isDirty}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
          <Tooltip content="Revert to the last saved state">
            <span className="inline-flex">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setDiscardAction("revert")}
                disabled={!isDirty}
                aria-label="Revert unsaved changes"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="primary"
            size="sm"
            onClick={onPublish}
            disabled={isDirty || issues.some((issue) => issue.level === "error")}
          >
            <Rocket className="h-3.5 w-3.5" /> {flow.status === "published" ? "Update Deployment" : "Deploy"}
          </Button>
          <Tooltip content="Export FlowSpec JSON">
            <Button variant="ghost" size="icon" onClick={exportFlow} aria-label="Export FlowSpec JSON">
              <Download className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <NodePalette onAdd={createNode} hasStart={flow.nodes.some((node) => node.data.kind === "start")} />
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            className="min-h-0 flex-1"
            onDrop={onDrop}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
          >
            <ReactFlow<VoiceNode, VoiceEdge>
              nodes={renderedNodes}
              edges={renderedEdges}
              nodeTypes={nodeTypes}
              connectionMode={ConnectionMode.Loose}
              edgesReconnectable
              elevateEdgesOnSelect
              isValidConnection={isValidConnection}
              connectionRadius={24}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onReconnect={onReconnect}
              reconnectRadius={6}
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
                setSelectedEdgeId(null);
              }}
              onEdgeClick={(_, edge) => {
                setSelectedNodeId(null);
                setSelectedEdgeId(edge.id);
              }}
              onPaneClick={() => {
                setSelectedNodeId(null);
                setSelectedEdgeId(null);
              }}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.18 }}
              minZoom={0.35}
              maxZoom={1.4}
              defaultEdgeOptions={{
                type: "smoothstep",
                animated: false,
                labelStyle: { fill: "var(--text-muted)", fontSize: 9, fontWeight: 600 },
                labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.92 },
                labelBgPadding: [5, 3],
                labelBgBorderRadius: 4,
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--canvas-dot)" />
              <Controls position="bottom-left" showInteractive={false} />
              <MiniMap
                position="bottom-right"
                pannable
                zoomable
                nodeStrokeWidth={2}
                maskColor="var(--minimap-mask)"
                nodeColor={(node) => {
                  const data = node.data as VoiceNodeData;
                  return data.kind === "start"
                    ? "#10b981"
                    : data.kind === "end"
                      ? "#64748b"
                      : data.kind === "tool"
                        ? "#06b6d4"
                        : "#3b82f6";
                }}
              />
              {selectedNode && (
                <Panel position="top-center" className="!m-4">
                  <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1.5 shadow-lg">
                    <span className="max-w-48 truncate px-2 text-[10px] font-semibold text-[var(--text-secondary)]">
                      {selectedNode.data.name}
                    </span>
                    {selectedNode.id === flow.entryNodeId ? (
                      <Tooltip content="The Start block cannot be deleted">
                        <span className="inline-flex">
                          <Button variant="ghost" size="sm" disabled>
                            <LockKeyhole className="h-3.5 w-3.5" /> Delete
                          </Button>
                        </span>
                      </Tooltip>
                    ) : (
                      <Button variant="danger" size="sm" onClick={() => requestDeleteNode(selectedNode.id)}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </Button>
                    )}
                  </div>
                </Panel>
              )}
              <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-[9px] text-[var(--text-muted)] shadow-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" /> Twilio Media Streams
                <span className="text-[var(--border-strong)]">/</span>
                <span className="font-mono">FlowSpec 2.0</span>
              </div>
            </ReactFlow>
          </div>
          <ValidationConsole
            open={consoleOpen}
            issues={issues}
            onToggle={() => setConsoleOpen((value) => !value)}
            onSelectNode={(nodeId) => {
              setSelectedNodeId(nodeId);
              setSelectedEdgeId(null);
              const node = flow.nodes.find((candidate) => candidate.id === nodeId);
              if (node) void fitView({ nodes: [node], duration: 300, padding: 0.8 });
            }}
          />
        </div>
        <Inspector
          node={selectedNode}
          edge={selectedEdge}
          tools={tools}
          functions={functions}
          stateSchemas={stateSchemas}
          selectedStateSchemaId={flow.stateSchemaId}
          bindingSuggestions={bindingSuggestions}
          edges={flow.edges}
          onUpdateNode={updateNode}
          onUpdateEdge={updateEdge}
          onSelectStateSchema={(stateSchemaId) => commit({ stateSchemaId })}
          onDeleteNode={requestDeleteNode}
          onDeleteEdge={deleteEdge}
          onSelectEdge={(id) => {
            setSelectedNodeId(null);
            setSelectedEdgeId(id);
          }}
          canDeleteNode={selectedNode?.id !== flow.entryNodeId}
        />
      </div>
      <Dialog
        open={Boolean(pendingDeleteNode)}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteNodeId(null);
        }}
        title="Delete this block?"
        description="This action cannot be undone in the current editing session."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDeleteNodeId(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteNode}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        }
      >
        {pendingDeleteNode && (
          <div className="rounded-xl border border-[var(--danger-soft)] bg-[var(--danger-soft)]/55 p-4">
            <p className="text-sm font-bold text-[var(--text)]">{pendingDeleteNode.data.name}</p>
            <p className="mt-1.5 text-xs leading-5 text-[var(--text-secondary)]">
              {pendingDeleteEdgeCount} connected Edge{pendingDeleteEdgeCount === 1 ? "" : "s"} will also be deleted.
            </p>
          </div>
        )}
      </Dialog>
      <Dialog
        open={discardAction !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardAction(null);
        }}
        title={discardAction === "leave" ? "Discard unsaved changes?" : "Revert to the last saved state?"}
        description="All changes made since the last save will be discarded."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiscardAction(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDiscard}>
              <RotateCcw className="h-4 w-4" /> {discardAction === "leave" ? "Discard and leave" : "Revert"}
            </Button>
          </>
        }
      >
        <p className="text-xs leading-5 text-[var(--text-secondary)]">This action cannot be undone.</p>
      </Dialog>
    </main>
  );
}
