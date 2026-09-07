import { describe, expect, it } from "vitest";
import { fixtureFlow } from "../test/fixtures";
import { migrateFlow } from "./migrate";

describe("flow migration", () => {
  it("forces the Start session to manual response creation", () => {
    const legacy = structuredClone(fixtureFlow);
    legacy.nodes.find((node) => node.data.kind === "start")!.data.startConfig!.turnDetection.createResponse = true;

    const migrated = migrateFlow(legacy, fixtureFlow);
    const start = migrated.nodes.find((node) => node.data.kind === "start")!;

    expect(start.data.startConfig?.turnDetection.createResponse).toBe(false);
  });

  it("converts legacy Node modes into editable runtime settings", () => {
    const legacy = structuredClone(fixtureFlow) as unknown as Record<string, any>;
    const collector = legacy.nodes.find((node: Record<string, any>) => node.data.kind === "node");
    collector.data.nodeMode = "capture";
    delete collector.data.runtime;

    const migrated = migrateFlow(legacy, fixtureFlow);
    const migratedCollector = migrated.nodes.find((node) => node.data.name === "Collect Choice")!;

    expect(migratedCollector.data).not.toHaveProperty("nodeMode");
    expect(migratedCollector.data.runtime).toMatchObject({
      responseMode: "manual",
      outputModalities: "text",
      toolChoice: "required",
      followUpAudio: true,
    });
  });

  it("normalizes legacy semantic Node IDs without breaking Edge references", () => {
    const legacy = structuredClone(fixtureFlow) as any;
    const legacyIds = ["start", "collect", "end"];
    const idMap = new Map(legacy.nodes.map((node: any, index: number) => [node.id, legacyIds[index]]));
    legacy.nodes = legacy.nodes.map((node: any, index: number) => ({
      ...node,
      id: legacyIds[index],
    }));
    legacy.entryNodeId = idMap.get(legacy.entryNodeId);
    legacy.edges = legacy.edges.map((edge: any) => ({
      ...edge,
      source: idMap.get(edge.source),
      target: idMap.get(edge.target),
    }));

    const migrated = migrateFlow(legacy, fixtureFlow);
    const nodeIds = new Set(migrated.nodes.map((node) => node.id));

    expect(migrated.nodes.every((node) => /^(start|node|tool|end)_[a-z0-9]{8}$/.test(node.id))).toBe(true);
    expect(nodeIds.has(migrated.entryNodeId)).toBe(true);
    expect(migrated.edges.every((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))).toBe(true);
  });

  it("assigns missing Edge ports once and keeps them fixed after blocks move", () => {
    const legacy = structuredClone(fixtureFlow) as any;
    legacy.edges.forEach((edge: any) => {
      delete edge.sourceHandle;
      delete edge.targetHandle;
    });

    const migrated = migrateFlow(legacy, fixtureFlow);
    const firstEdge = migrated.edges[0];
    expect(firstEdge.sourceHandle).toBeTruthy();
    expect(firstEdge.targetHandle).toBeTruthy();

    const moved = structuredClone(migrated) as any;
    const target = moved.nodes.find((node: any) => node.id === firstEdge.target);
    target.position = { x: -1000, y: -1000 };
    const migratedAgain = migrateFlow(moved, fixtureFlow);
    const sameEdge = migratedAgain.edges.find((edge) => edge.id === firstEdge.id)!;

    expect(sameEdge.sourceHandle).toBe(firstEdge.sourceHandle);
    expect(sameEdge.targetHandle).toBe(firstEdge.targetHandle);
  });

  it("moves legacy Timeout Edges into Condition rules", () => {
    const legacy = structuredClone(fixtureFlow) as any;
    const edge = legacy.edges[0];
    edge.data = {
      ...edge.data,
      routeType: "timeout",
      timeoutMs: 12000,
      condition: undefined,
    };

    const migrated = migrateFlow(legacy, fixtureFlow);
    const migratedEdge = migrated.edges.find((candidate) => candidate.id === edge.id)!;

    expect(migratedEdge.data?.routeType).toBe("condition");
    expect(migratedEdge.data?.condition?.rules).toEqual([
      expect.objectContaining({ kind: "timeout", timeoutMs: 12000 }),
    ]);
  });

  it("converts legacy condition strings", () => {
    const legacy = structuredClone(fixtureFlow) as any;
    legacy.edges[1].data = {
      label: "Finish",
      condition: "session.choice = finish",
    };

    const migrated = migrateFlow(legacy, fixtureFlow);

    expect(migrated.edges[1].data).toMatchObject({
      name: "Finish",
      routeType: "condition",
      condition: {
        logic: "all",
        rules: [
          expect.objectContaining({
            path: "session.choice",
            comparator: "equals",
            value: "finish",
          }),
        ],
      },
    });
  });

  it("removes only Edges whose source or target no longer exists", () => {
    const legacy = structuredClone(fixtureFlow);
    legacy.edges.push({
      id: "edge-dangling",
      source: "node_00000001",
      target: "missing-node",
      type: "smoothstep",
      data: { name: "Missing", routeType: "always", priority: 9 },
    });

    const migrated = migrateFlow(legacy, fixtureFlow);

    expect(migrated.edges.some((edge) => edge.id === "edge-dangling")).toBe(false);
    expect(migrated.edges).toHaveLength(fixtureFlow.edges.length);
  });

  it("uses the fallback for invalid documents", () => {
    expect(migrateFlow({ name: "Invalid" }, fixtureFlow)).toEqual(fixtureFlow);
  });
});
