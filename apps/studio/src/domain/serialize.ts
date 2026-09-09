import type { FlowDocument } from "./flow";

export function serializeFlow(flow: FlowDocument, overrides: Partial<Pick<FlowDocument, "version" | "status">> = {}) {
  const start = flow.nodes.find((node) => node.data.kind === "start")?.data.startConfig;

  return {
    schema_version: flow.schemaVersion,
    id: flow.id,
    name: flow.name,
    description: flow.description,
    state_schema_id: flow.stateSchemaId,
    version: overrides.version ?? flow.version,
    status: overrides.status ?? flow.status,
    entry_node_id: flow.entryNodeId,
    updated_at: flow.updatedAt,
    start: start
      ? {
          language: start.language,
          initial_input_gate_ms: start.initialInputGateMs,
          session_update: {
            type: "realtime" as const,
            model: start.model,
            instructions: start.baseInstructions,
            output_modalities: ["audio"] as const,
            audio: {
              input: {
                format: { type: start.inputFormat },
                transcription: start.transcription.enabled
                  ? {
                      model: start.transcription.model,
                      language: start.transcription.languages[0] ?? start.language,
                      prompt: start.transcription.keywords.join(", "),
                    }
                  : null,
                turn_detection: {
                  type: start.turnDetection.type,
                  ...(start.turnDetection.type === "server_vad"
                    ? {
                        threshold: start.turnDetection.threshold,
                        prefix_padding_ms: start.turnDetection.prefixPaddingMs,
                        silence_duration_ms: start.turnDetection.silenceDurationMs,
                      }
                    : { eagerness: start.turnDetection.eagerness }),
                  create_response: false,
                  interrupt_response: start.turnDetection.interruptResponse,
                },
              },
              output: {
                format: { type: start.outputFormat },
                voice: start.voice,
                speed: start.speed,
              },
            },
          },
        }
      : null,
    nodes: flow.nodes.map((node) => ({
      id: node.id,
      type: node.data.kind,
      name: node.data.name,
      description: node.data.description,
      objective: node.data.objective,
      instructions: node.data.instructions,
      response_mode: node.data.responseMode,
      tool_choice: node.data.toolChoice,
      tool_ids: node.data.toolIds,
      tool_input_bindings: (node.data.toolInputBindings ?? []).map((binding) => ({
        tool_id: binding.toolId,
        input_mapping: Object.fromEntries(binding.inputMappings.map((mapping) => [mapping.inputName, mapping.value])),
      })),
      tool_function_bindings: (node.data.toolFunctionBindings ?? []).map((binding) => ({
        tool_id: binding.toolId,
        function_id: binding.functionId,
        input_mapping: Object.fromEntries(binding.inputMappings.map((mapping) => [mapping.inputName, mapping.value])),
      })),
      runtime: node.data.runtime
        ? {
            response_mode: node.data.runtime.responseMode,
            tool_choice: node.data.runtime.toolChoice,
            parallel_tool_calls: node.data.runtime.parallelToolCalls,
            output_modalities: [node.data.runtime.outputModalities],
            follow_up_audio: node.data.runtime.followUpAudio,
            speed_override: node.data.runtime.speedOverride,
            vad_silence_override_ms: node.data.runtime.vadSilenceOverrideMs,
            max_output_tokens: node.data.runtime.maxOutputTokens,
          }
        : undefined,
      tool: node.data.toolConfig
        ? {
            tool_id: node.data.toolConfig.toolId,
            execution: node.data.toolConfig.execution,
            timeout_ms: node.data.toolConfig.timeoutMs,
            retry_count: node.data.toolConfig.retryCount,
          }
        : undefined,
      end: node.data.endConfig
        ? {
            final_message: node.data.endConfig.finalMessage,
            wait_for_playback_mark: node.data.endConfig.waitForPlaybackMark,
            playback_timeout_ms: node.data.endConfig.playbackTimeoutMs,
            fallback_grace_ms: node.data.endConfig.fallbackGraceMs,
            save_transcript: node.data.endConfig.saveTranscript,
            end_reason: node.data.endConfig.endReason,
          }
        : undefined,
      position: node.position,
    })),
    edges: flow.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      name: edge.data?.name ?? "Next",
      route_type: edge.data?.routeType === "timeout" ? "condition" : (edge.data?.routeType ?? "always"),
      condition:
        edge.data?.routeType === "timeout"
          ? {
              logic: "any",
              rules: [{ id: `rule-${edge.id}-timeout`, kind: "timeout", timeout_ms: edge.data.timeoutMs ?? 15000 }],
            }
          : edge.data?.condition
            ? {
                logic: edge.data.condition.logic,
                rules: edge.data.condition.rules.map((rule) =>
                  rule.kind === "timeout"
                    ? { id: rule.id, kind: "timeout", timeout_ms: rule.timeoutMs ?? 15000 }
                    : { id: rule.id, kind: "state", path: rule.path, comparator: rule.comparator, value: rule.value },
                ),
              }
            : undefined,
      priority: edge.data?.priority ?? 1,
    })),
  };
}
