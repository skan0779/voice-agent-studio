import { describe, expect, it } from "vitest";
import { fixtureFlow } from "../test/fixtures";
import { createAgentFlow, migrateAgents, migrationFallbackFlow } from "./agents";

describe("agent flows", () => {
  it("creates a blank agent with Start and End blocks", () => {
    const agent = createAgentFlow("Care Agent", "Checks in with residents.", {
      id: "agent-care",
      now: "2026-08-24T00:00:00.000Z",
    });

    expect(agent.id).toBe("agent-care");
    expect(agent.version).toBe(0);
    expect(agent.nodes.map((node) => node.data.kind)).toEqual(["start", "end"]);
    expect(agent.nodes.every((node) => /^(start|end)_[a-z0-9]{8}$/.test(node.id))).toBe(true);
    expect(agent.entryNodeId).toBe(agent.nodes[0].id);
    expect(agent.edges[0]).toMatchObject({ source: agent.nodes[0].id, target: agent.nodes[1].id });
    expect(agent.edges).toHaveLength(1);
    expect(agent.nodes[0].data.startConfig?.baseInstructions).not.toContain("온콜");
    expect(agent.nodes[1].data.endConfig?.saveTranscript).toBe(true);
  });

  it("preserves an intentionally empty agent library", () => {
    expect(migrateAgents([], fixtureFlow)).toEqual([]);
  });

  it("preserves stored instructions during migration", () => {
    const stored = structuredClone(fixtureFlow);
    stored.version = 7;
    const start = stored.nodes.find((node) => node.data.kind === "start")!;
    start.data.startConfig!.baseInstructions = "Stored in PostgreSQL";

    const [migrated] = migrateAgents([stored], migrationFallbackFlow);

    expect(migrated.nodes.find((node) => node.data.kind === "start")?.data.startConfig?.baseInstructions).toBe(
      "Stored in PostgreSQL",
    );
    expect(migrated.version).toBe(7);
  });
});
