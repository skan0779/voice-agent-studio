import { defaultEndConfig, defaultStartConfig, defaultToolBlockConfig } from "./defaults";
import { assignMissingEdgeHandles } from "./edgeHandles";
import type { FlowDocument, RouteData, VoiceNodeData } from "./flow";
import { normalizeFlowNodeIds } from "./nodeIds";

function migrateToolFunctionBindings(data: Record<string, any>) {
  return (Array.isArray(data.toolFunctionBindings) ? data.toolFunctionBindings : [])
    .filter((binding): binding is Record<string, any> => Boolean(binding) && typeof binding === "object")
    .filter((binding) => typeof binding.toolId === "string" && typeof binding.functionId === "string")
    .map((binding) => ({
      toolId: binding.toolId as string,
      functionId: binding.functionId as string,
      inputMappings: Array.isArray(binding.inputMappings)
        ? binding.inputMappings
            .filter((mapping): mapping is Record<string, any> => Boolean(mapping) && typeof mapping === "object")
            .filter((mapping) => typeof mapping.inputName === "string" && typeof mapping.value === "string")
            .map((mapping) => ({
              inputName: mapping.inputName as string,
              value: mapping.value as string,
            }))
        : [],
    }));
}

function migrateToolInputBindings(data: Record<string, any>) {
  return (Array.isArray(data.toolInputBindings) ? data.toolInputBindings : [])
    .filter((binding): binding is Record<string, any> => Boolean(binding) && typeof binding === "object")
    .filter((binding) => typeof binding.toolId === "string")
    .map((binding) => ({
      toolId: binding.toolId as string,
      inputMappings: Array.isArray(binding.inputMappings)
        ? binding.inputMappings
            .filter((mapping): mapping is Record<string, any> => Boolean(mapping) && typeof mapping === "object")
            .filter((mapping) => typeof mapping.inputName === "string" && typeof mapping.value === "string")
            .map((mapping) => ({
              inputName: mapping.inputName as string,
              value: mapping.value as string,
            }))
        : [],
    }));
}

function migrateCondition(raw: unknown, edgeId: string): Partial<RouteData> {
  if (raw === "fallback") return { routeType: "fallback" };
  if (typeof raw !== "string" || !raw.trim()) return { routeType: "always" };

  const match = raw.match(/^\s*([\w.]+)\s*(?:==|=)\s*(.+?)\s*$/);
  if (!match) {
    return { routeType: "condition", condition: { logic: "all", rules: [] } };
  }
  return {
    routeType: "condition",
    condition: {
      logic: "all",
      rules: [
        {
          id: `rule-${edgeId}`,
          kind: "state",
          path: match[1],
          comparator: "equals",
          value: match[2],
        },
      ],
    },
  };
}

function normalizeConditionGroup(raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined;
  const condition = raw as Record<string, any>;
  const rules = Array.isArray(condition.rules) ? condition.rules : [];
  return {
    logic: condition.logic === "any" ? ("any" as const) : ("all" as const),
    rules: rules.map((rule: Record<string, any>, index: number) => {
      const legacyBooleanCheck = rule.comparator === "is_true";
      return {
        id: typeof rule.id === "string" ? rule.id : `rule-${index + 1}`,
        kind: rule.kind === "timeout" ? ("timeout" as const) : ("state" as const),
        path: typeof rule.path === "string" ? rule.path : "",
        comparator: legacyBooleanCheck ? ("equals" as const) : (rule.comparator ?? "equals"),
        value: legacyBooleanCheck ? "true" : typeof rule.value === "string" ? rule.value : "",
        ...(rule.kind === "timeout" || typeof rule.timeoutMs === "number" || typeof rule.timeout_ms === "number"
          ? { timeoutMs: rule.timeoutMs ?? rule.timeout_ms ?? 15000 }
          : {}),
      };
    }),
  };
}

function migrateNodeData(data: Record<string, any>, agent: Record<string, any>): VoiceNodeData {
  if (data.kind === "start") {
    const current = data.startConfig ?? {};
    return {
      ...data,
      kind: "start",
      name: "Start",
      description: "",
      responseMode: "none",
      toolChoice: "none",
      toolIds: data.toolIds ?? [],
      startConfig: {
        ...defaultStartConfig,
        ...current,
        model: current.model ?? agent.model ?? defaultStartConfig.model,
        voice: current.voice ?? agent.voice ?? defaultStartConfig.voice,
        speed: current.speed ?? agent.speed ?? defaultStartConfig.speed,
        language: current.language ?? agent.language ?? defaultStartConfig.language,
        baseInstructions: current.baseInstructions ?? agent.baseInstructions ?? defaultStartConfig.baseInstructions,
        turnDetection: {
          ...defaultStartConfig.turnDetection,
          ...(current.turnDetection ?? {}),
          createResponse: false,
          silenceDurationMs:
            current.turnDetection?.silenceDurationMs ??
            agent.vadSilenceMs ??
            defaultStartConfig.turnDetection.silenceDurationMs,
        },
        transcription: {
          ...defaultStartConfig.transcription,
          ...(current.transcription ?? {}),
        },
      },
    } as VoiceNodeData;
  }

  if (data.kind === "end") {
    const current = data.endConfig ?? {};
    return {
      ...data,
      kind: "end",
      responseMode: "none",
      toolChoice: "none",
      toolIds: data.toolIds ?? [],
      endConfig: {
        finalMessage: current.finalMessage ?? defaultEndConfig.finalMessage,
        waitForPlaybackMark: current.waitForPlaybackMark ?? defaultEndConfig.waitForPlaybackMark,
        playbackTimeoutMs: current.playbackTimeoutMs ?? defaultEndConfig.playbackTimeoutMs,
        fallbackGraceMs: current.fallbackGraceMs ?? defaultEndConfig.fallbackGraceMs,
        saveTranscript: current.saveTranscript ?? defaultEndConfig.saveTranscript,
        endReason: current.endReason ?? defaultEndConfig.endReason,
      },
    } as VoiceNodeData;
  }

  if (data.kind === "action" || data.kind === "tool") {
    return {
      ...data,
      kind: "tool",
      responseMode: "none",
      toolChoice: "none",
      toolIds: data.toolIds ?? [],
      toolConfig: {
        ...defaultToolBlockConfig,
        ...(data.toolConfig ?? {}),
        toolId: data.toolConfig?.toolId ?? data.toolIds?.[0] ?? "",
      },
    } as VoiceNodeData;
  }

  const legacyNodeMode =
    data.nodeMode ?? (data.kind === "capture" ? "capture" : data.kind === "condition" ? "router" : "conversation");
  const responseMode =
    data.responseMode ?? (legacyNodeMode === "router" || data.responseStrategy === "none" ? "none" : "manual");
  const toolChoice =
    data.toolChoice ??
    (legacyNodeMode === "capture" || data.responseStrategy === "capture_then_speak"
      ? "required"
      : legacyNodeMode === "router"
        ? "none"
        : "auto");
  const current = { ...data };
  delete current.nodeMode;
  delete current.responseStrategy;
  return {
    ...current,
    kind: "node",
    instructions: data.instructions ?? "",
    responseMode,
    toolChoice,
    toolIds: data.toolIds ?? [],
    toolInputBindings: migrateToolInputBindings(data),
    toolFunctionBindings: migrateToolFunctionBindings(data),
    runtime: {
      responseMode,
      toolChoice,
      parallelToolCalls: data.runtime?.parallelToolCalls === true || data.runtime?.parallel_tool_calls === true,
      outputModalities: legacyNodeMode === "capture" ? "text" : legacyNodeMode === "router" ? "text" : "audio",
      followUpAudio: legacyNodeMode === "capture",
      speedOverride: null,
      vadSilenceOverrideMs: null,
      maxOutputTokens: 1024,
      ...(data.runtime ?? {}),
    },
  } as VoiceNodeData;
}

function removeDanglingEdges(flow: FlowDocument): FlowDocument {
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const edges = flow.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return edges.length === flow.edges.length ? flow : { ...flow, edges };
}

export function migrateFlow(raw: unknown, fallback: FlowDocument): FlowDocument {
  if (!raw || typeof raw !== "object") {
    return assignMissingEdgeHandles(structuredClone(fallback));
  }
  const source = raw as Record<string, any>;
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) {
    return assignMissingEdgeHandles(structuredClone(fallback));
  }

  const agent = source.agent ?? {};
  const migrated: FlowDocument = {
    schemaVersion: "2.0",
    id: source.id ?? fallback.id,
    name: source.name ?? fallback.name,
    description: source.description ?? fallback.description,
    stateSchemaId: typeof source.stateSchemaId === "string" ? source.stateSchemaId : fallback.stateSchemaId,
    version: source.version ?? fallback.version,
    status: source.status === "published" ? "published" : "draft",
    entryNodeId: source.entryNodeId ?? "start",
    updatedAt: source.updatedAt ?? new Date().toISOString(),
    nodes: source.nodes.map(
      (node: Record<string, any>) =>
        ({
          ...node,
          type: "voiceNode",
          data: migrateNodeData(node.data ?? {}, agent),
        }) as FlowDocument["nodes"][number],
    ),
    edges: source.edges.map((edge: Record<string, any>, index: number) => {
      const data = edge.data ?? {};
      const migratedData = data.routeType
        ? data
        : { ...data, ...migrateCondition(data.condition, edge.id ?? String(index)) };
      const legacyTimeout = migratedData.routeType === "timeout";
      return {
        ...edge,
        type: "smoothstep",
        data: {
          name: migratedData.name ?? migratedData.label ?? "Next",
          routeType: legacyTimeout ? "condition" : (migratedData.routeType ?? "always"),
          condition: legacyTimeout
            ? {
                logic: "any",
                rules: [
                  {
                    id: `rule-${edge.id ?? index}-timeout`,
                    kind: "timeout",
                    path: "",
                    comparator: "equals",
                    value: "",
                    timeoutMs: migratedData.timeoutMs ?? 15000,
                  },
                ],
              }
            : normalizeConditionGroup(migratedData.condition),
          priority: migratedData.priority ?? index + 1,
        },
      } as FlowDocument["edges"][number];
    }),
  };

  return assignMissingEdgeHandles(removeDanglingEdges(normalizeFlowNodeIds(migrated)));
}
