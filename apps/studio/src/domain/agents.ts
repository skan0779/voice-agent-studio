import { defaultEndConfig, defaultStartConfig } from "./defaults";
import type { FlowDocument, VoiceNode } from "./flow";
import { migrateFlow } from "./migrate";
import { createNodeId } from "./nodeIds";

function node(id: string, x: number, y: number, data: VoiceNode["data"]): VoiceNode {
  return { id, type: "voiceNode", position: { x, y }, data };
}

function buildAgentFlow(
  id: string,
  name: string,
  description: string,
  startNodeId: string,
  endNodeId: string,
  now: string,
): FlowDocument {
  return {
    schemaVersion: "2.0",
    id,
    name: name.trim(),
    description: description.trim(),
    stateSchemaId: "",
    version: 0,
    status: "draft",
    entryNodeId: startNodeId,
    updatedAt: now,
    nodes: [
      node(startNodeId, 120, 220, {
        kind: "start",
        name: "Start",
        description: "",
        objective: "Configure and open the Realtime session.",
        instructions: "",
        responseMode: "none",
        toolIds: [],
        toolChoice: "none",
        startConfig: structuredClone(defaultStartConfig),
        health: "ready",
      }),
      node(endNodeId, 560, 220, {
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
      }),
    ],
    edges: [
      {
        id: `edge-${startNodeId}-${endNodeId}`,
        source: startNodeId,
        target: endNodeId,
        sourceHandle: "right",
        targetHandle: "left",
        type: "smoothstep",
        data: { name: "Next", routeType: "always", priority: 1 },
      },
    ],
  };
}

export const migrationFallbackFlow: FlowDocument = buildAgentFlow(
  "agent-fallback",
  "Agent",
  "",
  "start_fallback",
  "end_fallback",
  "1970-01-01T00:00:00.000Z",
);

export function createAgentFlow(
  name: string,
  description: string,
  options: { id?: string; now?: string } = {},
): FlowDocument {
  const id = options.id ?? `agent-${crypto.randomUUID()}`;
  const now = options.now ?? new Date().toISOString();
  const startNodeId = createNodeId("start");
  const endNodeId = createNodeId("end");
  return buildAgentFlow(id, name, description, startNodeId, endNodeId, now);
}

export function migrateAgents(raw: unknown, fallback: FlowDocument): FlowDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object").map((item) => migrateFlow(item, fallback));
}

export function duplicateAgentFlow(agent: FlowDocument): FlowDocument {
  const copy = structuredClone(agent);
  return {
    ...copy,
    id: `agent-${crypto.randomUUID()}`,
    name: `${agent.name} Copy`,
    version: 0,
    status: "draft",
    updatedAt: new Date().toISOString(),
  };
}
