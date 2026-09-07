import { describe, expect, it } from "vitest";
import { fixtureFlow, fixtureFunctions, fixtureStateSchemas, fixtureTools } from "../test/fixtures";
import { validateFlow } from "./validation";

describe("flow validation", () => {
  it("accepts a fully connected generic flow", () => {
    expect(validateFlow(fixtureFlow, fixtureStateSchemas, fixtureFunctions, fixtureTools)).toEqual([]);
  });

  it("requires explicit values for required Function inputs", () => {
    const flow = structuredClone(fixtureFlow);
    const collector = flow.nodes.find((node) => node.data.kind === "node")!;
    collector.data.toolFunctionBindings![0].inputMappings = [];

    expect(validateFlow(flow, fixtureStateSchemas, fixtureFunctions, fixtureTools)).toContainEqual(
      expect.objectContaining({
        id: `function-input-${collector.id}-function-apply-choice`,
      }),
    );
  });

  it("flags a Node that requires a Tool without selecting one", () => {
    const flow = structuredClone(fixtureFlow);
    const collector = flow.nodes.find((node) => node.data.kind === "node")!;
    collector.data.toolIds = [];

    expect(validateFlow(flow).some((issue) => issue.id === `tool-${collector.id}`)).toBe(true);
  });

  it("requires a valid State Schema assignment", () => {
    const flow = structuredClone(fixtureFlow);
    flow.stateSchemaId = "missing-state";
    expect(validateFlow(flow, fixtureStateSchemas).some((issue) => issue.id === "invalid-state-schema")).toBe(true);

    flow.stateSchemaId = "";
    expect(validateFlow(flow, fixtureStateSchemas).some((issue) => issue.id === "missing-state-schema")).toBe(true);
  });

  it("flags duplicate conditions without requiring manual priorities", () => {
    const flow = structuredClone(fixtureFlow);
    const route = flow.edges.find((edge) => edge.data?.routeType === "condition")!;
    flow.edges.push({
      ...structuredClone(route),
      id: "edge-duplicate-condition",
    });

    expect(
      validateFlow(flow, fixtureStateSchemas).some((issue) => issue.id === "condition-conflict-node_00000001"),
    ).toBe(true);
  });

  it("validates Timeout rules mixed with State conditions", () => {
    const flow = structuredClone(fixtureFlow);
    const route = flow.edges.find((edge) => edge.data?.routeType === "condition")!;
    route.data!.condition!.logic = "any";
    route.data!.condition!.rules.push({
      id: "rule-timeout",
      kind: "timeout",
      path: "",
      comparator: "equals",
      value: "",
      timeoutMs: 15000,
    });

    expect(validateFlow(flow, fixtureStateSchemas).some((issue) => issue.id.startsWith("timeout-"))).toBe(false);

    route.data!.condition!.rules.at(-1)!.timeoutMs = 0;
    expect(
      validateFlow(flow, fixtureStateSchemas).some((issue) => issue.id === `timeout-${route.id}-rule-timeout`),
    ).toBe(true);
  });

  it("finds a disconnected cycle", () => {
    const flow = structuredClone(fixtureFlow);
    const collector = flow.nodes.find((node) => node.data.kind === "node")!;
    flow.edges = flow.edges.filter((edge) => edge.target !== collector.id);
    flow.edges.push({
      id: "edge-self-cycle",
      source: collector.id,
      target: collector.id,
      type: "smoothstep",
      data: { name: "Loop", routeType: "always", priority: 1 },
    });

    expect(validateFlow(flow).some((issue) => issue.id === `unreachable-${collector.id}`)).toBe(true);
  });
});
