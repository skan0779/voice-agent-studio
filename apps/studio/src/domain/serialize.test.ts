import { describe, expect, it } from "vitest";
import { fixtureFlow } from "../test/fixtures";
import { serializeFlow } from "./serialize";

describe("FlowSpec 2.0 serialization", () => {
  it("exports the Start block as a Realtime session.update contract", () => {
    const flow = structuredClone(fixtureFlow);
    flow.nodes.find((node) => node.data.kind === "start")!.data.startConfig!.turnDetection.createResponse = true;
    const spec = serializeFlow(flow);

    expect(spec.schema_version).toBe("2.0");
    expect(spec.state_schema_id).toBe("state-example");
    expect(spec.start?.session_update.model).toBe("gpt-realtime-2.1");
    expect(spec.start?.session_update.audio.input.format.type).toBe("audio/pcmu");
    expect(spec.start?.session_update.audio.input.turn_detection.create_response).toBe(false);
    expect(spec.start?.session_update.audio.input.turn_detection).not.toHaveProperty("eagerness");
    expect(spec.start).not.toHaveProperty("connection_id");
  });

  it("only exports semantic VAD fields for semantic turn detection", () => {
    const flow = structuredClone(fixtureFlow);
    flow.nodes.find((node) => node.data.kind === "start")!.data.startConfig!.turnDetection.type = "semantic_vad";

    const turnDetection = serializeFlow(flow).start!.session_update.audio.input.turn_detection;

    expect(turnDetection).toHaveProperty("eagerness", "auto");
    expect(turnDetection).not.toHaveProperty("threshold");
    expect(turnDetection).not.toHaveProperty("prefix_padding_ms");
    expect(turnDetection).not.toHaveProperty("silence_duration_ms");
  });

  it("keeps runtime payloads snake_case and preserves Tool bindings", () => {
    const spec = serializeFlow(fixtureFlow);
    const collector = spec.nodes.find((node) => node.tool_ids.includes("collect_choice"))!;
    const json = JSON.stringify(collector.runtime);

    expect(collector.runtime?.output_modalities).toEqual(["text"]);
    expect(collector.runtime?.follow_up_audio).toBe(true);
    expect(collector.runtime?.parallel_tool_calls).toBe(false);
    expect(collector.tool_input_bindings).toEqual([
      {
        tool_id: "collect_choice",
        input_mapping: { options: '["continue", "finish"]' },
      },
    ]);
    expect(collector.tool_function_bindings).toEqual([
      {
        tool_id: "collect_choice",
        function_id: "function-apply-choice",
        input_mapping: { choice: "@tool.arguments.choice" },
      },
    ]);
    expect(json).toContain("max_output_tokens");
    expect(json).not.toContain("maxOutputTokens");
    expect(collector).not.toHaveProperty("mode");
  });

  it("serializes State and Timeout rules on the same conditional Edge", () => {
    const flow = structuredClone(fixtureFlow);
    const edge = flow.edges.find((candidate) => candidate.data?.routeType === "condition")!;
    edge.data!.condition!.logic = "any";
    edge.data!.condition!.rules.push({
      id: "rule-timeout",
      kind: "timeout",
      path: "",
      comparator: "equals",
      value: "",
      timeoutMs: 15000,
    });

    const serializedEdge = serializeFlow(flow).edges.find((candidate) => candidate.id === edge.id)!;

    expect(serializedEdge.route_type).toBe("condition");
    expect(serializedEdge.condition).toEqual(
      expect.objectContaining({
        logic: "any",
        rules: expect.arrayContaining([
          expect.objectContaining({
            kind: "state",
            path: "@state.session.choice",
          }),
          { id: "rule-timeout", kind: "timeout", timeout_ms: 15000 },
        ]),
      }),
    );
  });
});
