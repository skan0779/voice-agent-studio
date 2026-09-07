import type { FlowDocument, VoiceEdge, VoiceNode } from "./flow";

type EdgeHandleId = "top" | "right" | "bottom" | "left";
const edgeHandleIds = new Set<EdgeHandleId>(["top", "right", "bottom", "left"]);

function isEdgeHandleId(value: string | null | undefined): value is EdgeHandleId {
  return Boolean(value && edgeHandleIds.has(value as EdgeHandleId));
}

function inferEdgeHandles(
  edge: VoiceEdge,
  nodes: VoiceNode[],
): { sourceHandle: EdgeHandleId; targetHandle: EdgeHandleId } | null {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  if (!source || !target) return null;

  const deltaX = target.position.x - source.position.x;
  const deltaY = target.position.y - source.position.y;
  const horizontal = Math.abs(deltaX) >= Math.abs(deltaY);

  if (horizontal) {
    return deltaX >= 0
      ? { sourceHandle: "right", targetHandle: "left" }
      : { sourceHandle: "left", targetHandle: "right" };
  }

  return deltaY >= 0
    ? { sourceHandle: "bottom", targetHandle: "top" }
    : { sourceHandle: "top", targetHandle: "bottom" };
}

/**
 * Assigns ports to legacy Edges exactly once. Once stored, moving a block must
 * never change which side of either block the Edge is attached to.
 */
export function assignMissingEdgeHandles(flow: FlowDocument): FlowDocument {
  let changed = false;
  const edges = flow.edges.map((edge) => {
    if (isEdgeHandleId(edge.sourceHandle) && isEdgeHandleId(edge.targetHandle)) return edge;
    const inferred = inferEdgeHandles(edge, flow.nodes);
    if (!inferred) return edge;
    changed = true;
    return {
      ...edge,
      sourceHandle: isEdgeHandleId(edge.sourceHandle) ? edge.sourceHandle : inferred.sourceHandle,
      targetHandle: isEdgeHandleId(edge.targetHandle) ? edge.targetHandle : inferred.targetHandle,
    };
  });

  return changed ? { ...flow, edges } : flow;
}
