import type { FlowDocument, NodeKind } from "./flow";

const NODE_ID_PATTERN = /^(start|node|tool|end)_[a-z0-9]{8}$/;

function nodePrefix(kind: NodeKind) {
  return kind;
}

function stableToken(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function createNodeId(kind: NodeKind) {
  const token =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replaceAll("-", "").slice(0, 8)
      : stableToken(`${Date.now()}:${Math.random()}`);
  return `${nodePrefix(kind)}_${token}`;
}

export function normalizeFlowNodeIds(flow: FlowDocument): FlowDocument {
  const assignedIds = new Set<string>();
  const idMap = new Map<string, string>();

  const nodes = flow.nodes.map((node, index) => {
    const expectedPrefix = `${nodePrefix(node.data.kind)}_`;
    let nextId =
      NODE_ID_PATTERN.test(node.id) && node.id.startsWith(expectedPrefix)
        ? node.id
        : `${expectedPrefix}${stableToken(`${flow.id}:${node.id}:${index}`)}`;
    let collisionIndex = 1;
    while (assignedIds.has(nextId)) {
      nextId = `${expectedPrefix}${stableToken(`${flow.id}:${node.id}:${index}:${collisionIndex}`)}`;
      collisionIndex += 1;
    }
    assignedIds.add(nextId);
    idMap.set(node.id, nextId);
    return { ...node, id: nextId };
  });

  return {
    ...flow,
    entryNodeId: idMap.get(flow.entryNodeId) ?? flow.entryNodeId,
    nodes,
    edges: flow.edges.map((edge) => ({
      ...edge,
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    })),
  };
}
