import type { FlowDocument, ToolDefinition, ValidationIssue } from "./flow";
import type { StateSchema } from "./state";
import { parseStateReferenceExpression } from "./stateReferences";
import type { ServiceFunction } from "./functions";

function toolArgumentMatchesFunctionInput(
  toolType: ToolDefinition["parameters"][number]["type"],
  inputType: ServiceFunction["inputs"][number]["type"],
) {
  if (toolType === inputType) return true;
  return inputType === "number" && toolType === "integer";
}

export function validateFlow(
  flow: FlowDocument,
  stateSchemas: StateSchema[] = [],
  functions: ServiceFunction[] = [],
  tools: ToolDefinition[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const outgoing = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const selectedStateSchema = stateSchemas.find((schema) => schema.id === flow.stateSchemaId);

  for (const edge of flow.edges) {
    outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + 1);
    adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target))
      issues.push({
        id: `dangling-${edge.id}`,
        level: "error",
        title: "Disconnected Edge",
        description: "This Edge points to a block that does not exist.",
      });
    if (edge.data?.routeType === "condition" && !edge.data.condition?.rules.length)
      issues.push({
        id: `condition-${edge.id}`,
        level: "error",
        title: "Empty Edge Condition",
        description: "A conditional route needs at least one rule.",
      });
    if (edge.data?.routeType === "condition") {
      const timeoutRules = edge.data.condition?.rules.filter((rule) => rule.kind === "timeout") ?? [];
      if (timeoutRules.length > 1)
        issues.push({
          id: `timeout-count-${edge.id}`,
          level: "error",
          title: "Duplicate Timeout Conditions",
          description: "Keep only one Timeout condition on an Edge.",
          nodeId: edge.source,
        });
      edge.data.condition?.rules.forEach((rule) => {
        if (rule.kind === "timeout") {
          if (!rule.timeoutMs)
            issues.push({
              id: `timeout-${edge.id}-${rule.id}`,
              level: "error",
              title: "Missing Timeout Duration",
              description: "Set the duration for the Timeout condition.",
              nodeId: edge.source,
            });
        } else if (selectedStateSchema && !parseStateReferenceExpression(rule.path, [selectedStateSchema])) {
          issues.push({
            id: `condition-state-${edge.id}-${rule.id}`,
            level: "error",
            title: "Invalid State Condition",
            description: `${rule.path || "The selected field"} is not available in the Agent State.`,
            nodeId: edge.source,
          });
        }
      });
    }
  }

  const startNodes = flow.nodes.filter((node) => node.data.kind === "start");
  if (startNodes.length !== 1 || startNodes[0]?.id !== flow.entryNodeId)
    issues.push({
      id: "missing-entry",
      level: "error",
      title: "Check the Start Block",
      description: "The flow needs exactly one Start block matching entry_node_id.",
    });
  const start = startNodes[0];
  if (start && !start.data.startConfig?.model)
    issues.push({
      id: "start-config",
      level: "error",
      title: "Incomplete Start Session",
      description: "Select a Realtime model.",
      nodeId: start.id,
    });
  if (!flow.stateSchemaId)
    issues.push({
      id: "missing-state-schema",
      level: "error",
      title: "Select a State Schema",
      description: "Assign the State Schema used to create a new instance for every call.",
      nodeId: start?.id,
    });
  else if (stateSchemas.length > 0 && !stateSchemas.some((schema) => schema.id === flow.stateSchemaId))
    issues.push({
      id: "invalid-state-schema",
      level: "error",
      title: "State Schema Is Unavailable",
      description: "Select an existing State Schema in the Start block.",
      nodeId: start?.id,
    });

  const reachable = new Set<string>();
  const queue = nodeIds.has(flow.entryNodeId) ? [flow.entryNodeId] : [];
  while (queue.length) {
    const current = queue.shift()!;
    if (reachable.has(current)) continue;
    reachable.add(current);
    for (const next of adjacency.get(current) ?? []) if (!reachable.has(next)) queue.push(next);
  }

  for (const node of flow.nodes) {
    const runtime = node.data.runtime;
    if (node.id !== flow.entryNodeId && !reachable.has(node.id))
      issues.push({
        id: `unreachable-${node.id}`,
        level: "error",
        title: `${node.data.name} Is Unreachable`,
        description: "Create an Edge path from Start to this block.",
        nodeId: node.id,
      });
    if (node.data.kind !== "end" && !outgoing.has(node.id))
      issues.push({
        id: `dead-end-${node.id}`,
        level: "error",
        title: `Flow Ends at ${node.data.name}`,
        description: "Connect it to another block or End.",
        nodeId: node.id,
      });
    if (node.data.kind === "node" && runtime?.responseMode !== "none" && !node.data.instructions.trim())
      issues.push({
        id: `instructions-${node.id}`,
        level: "warning",
        title: `${node.data.name} Has No Instructions`,
        description: "Describe what the agent should do in this step.",
        nodeId: node.id,
      });
    if (node.data.kind === "node" && runtime?.toolChoice === "required" && node.data.toolIds.length === 0)
      issues.push({
        id: `tool-${node.id}`,
        level: "error",
        title: `${node.data.name} Requires a Tool`,
        description: "Select at least one Tool or change Tool Choice.",
        nodeId: node.id,
      });
    if (node.data.kind === "node" && !node.data.runtime)
      issues.push({
        id: `runtime-${node.id}`,
        level: "error",
        title: `${node.data.name} Has No Runtime Settings`,
        description: "Configure response generation and output format.",
        nodeId: node.id,
      });
    if (
      node.data.kind === "node" &&
      node.data.runtime &&
      (node.data.responseMode !== node.data.runtime.responseMode ||
        node.data.toolChoice !== node.data.runtime.toolChoice)
    )
      issues.push({
        id: `runtime-sync-${node.id}`,
        level: "error",
        title: `${node.data.name} Has Conflicting Runtime Settings`,
        description: "Save the Node summary and Runtime settings again.",
        nodeId: node.id,
      });
    if (node.data.kind === "node" && runtime?.followUpAudio && runtime.outputModalities !== "text")
      issues.push({
        id: `follow-up-output-${node.id}`,
        level: "warning",
        title: `${node.data.name} Has an Inactive Follow-up`,
        description: "Follow-up Audio applies only when the first output is Text.",
        nodeId: node.id,
      });
    if (node.data.kind === "node" && runtime?.responseMode === "none" && runtime.followUpAudio)
      issues.push({
        id: `follow-up-response-${node.id}`,
        level: "warning",
        title: `${node.data.name} Cannot Create Follow-up Audio`,
        description: "Enable a model response or turn off Follow-up Audio.",
        nodeId: node.id,
      });
    for (const toolId of node.data.toolIds) {
      const tool = tools.find((candidate) => candidate.id === toolId);
      if (tools.length > 0 && !tool) {
        issues.push({
          id: `missing-tool-${node.id}-${toolId}`,
          level: "error",
          title: "Tool Is Unavailable",
          description: `${toolId} is selected by this Node but is not available in the Workspace.`,
          nodeId: node.id,
        });
        continue;
      }
      if (!tool?.inputs?.length) continue;
      const binding = (node.data.toolInputBindings ?? []).find((candidate) => candidate.toolId === toolId);
      const mappings = binding?.inputMappings ?? [];
      const mappingValues = new Map(mappings.map((mapping) => [mapping.inputName, mapping.value.trim()]));
      const duplicateInputs = mappings
        .map((mapping) => mapping.inputName)
        .filter((inputName, index, all) => all.indexOf(inputName) !== index);
      if (duplicateInputs.length)
        issues.push({
          id: `tool-input-duplicate-${node.id}-${toolId}`,
          level: "error",
          title: "Duplicate Tool Input Mapping",
          description: `Keep one mapping for: ${[...new Set(duplicateInputs)].join(", ")}.`,
          nodeId: node.id,
        });
      const knownInputs = new Set(tool.inputs.map((input) => input.name));
      const unknownInputs = mappings.filter((mapping) => !knownInputs.has(mapping.inputName));
      if (unknownInputs.length)
        issues.push({
          id: `tool-input-unknown-${node.id}-${toolId}`,
          level: "error",
          title: "Tool Input Is Unavailable",
          description: `Remove mappings for: ${unknownInputs.map((mapping) => mapping.inputName).join(", ")}.`,
          nodeId: node.id,
        });
      const missingInputs = tool.inputs.filter((input) => input.required && !mappingValues.get(input.name));
      if (missingInputs.length)
        issues.push({
          id: `tool-input-${node.id}-${toolId}`,
          level: "error",
          title: "Tool Inputs Need Values",
          description: `Map a runtime value for: ${missingInputs.map((input) => input.name).join(", ")}.`,
          nodeId: node.id,
        });
    }
    for (const binding of node.data.toolFunctionBindings ?? []) {
      if (!node.data.toolIds.includes(binding.toolId))
        issues.push({
          id: `function-tool-${node.id}-${binding.toolId}`,
          level: "error",
          title: "Function Binding Has No Tool",
          description: "Select the Tool used by this Function binding.",
          nodeId: node.id,
        });
      if (functions.length > 0 && !functions.some((serviceFunction) => serviceFunction.id === binding.functionId))
        issues.push({
          id: `function-missing-${node.id}-${binding.functionId}`,
          level: "error",
          title: "Function Is Unavailable",
          description: "Select an existing Function for this Tool.",
          nodeId: node.id,
        });
      const tool = tools.find((candidate) => candidate.id === binding.toolId);
      const serviceFunction = functions.find((candidate) => candidate.id === binding.functionId);
      if (tool && serviceFunction) {
        const mappingsByInput = new Map(
          binding.inputMappings.map((mapping) => [mapping.inputName, mapping.value.trim()]),
        );
        const duplicateInputs = binding.inputMappings
          .map((mapping) => mapping.inputName)
          .filter((inputName, index, all) => all.indexOf(inputName) !== index);
        if (duplicateInputs.length)
          issues.push({
            id: `function-input-duplicate-${node.id}-${binding.functionId}`,
            level: "error",
            title: "Duplicate Function Input Mapping",
            description: `Keep one mapping for: ${[...new Set(duplicateInputs)].join(", ")}.`,
            nodeId: node.id,
          });
        const knownInputs = new Set(serviceFunction.inputs.map((input) => input.name));
        const unknownInputs = binding.inputMappings.filter((mapping) => !knownInputs.has(mapping.inputName));
        if (unknownInputs.length)
          issues.push({
            id: `function-input-unknown-${node.id}-${binding.functionId}`,
            level: "error",
            title: "Function Input Is Unavailable",
            description: `Remove mappings for: ${unknownInputs.map((mapping) => mapping.inputName).join(", ")}.`,
            nodeId: node.id,
          });
        const missingInputs = serviceFunction.inputs.filter(
          (input) => input.required && !mappingsByInput.get(input.name),
        );
        if (missingInputs.length)
          issues.push({
            id: `function-input-${node.id}-${binding.functionId}`,
            level: "error",
            title: "Function Inputs Need Values",
            description: `Map a value for: ${missingInputs.map((input) => input.name).join(", ")}.`,
            nodeId: node.id,
          });
        serviceFunction.inputs.forEach((input) => {
          const value = mappingsByInput.get(input.name);
          if (!value?.startsWith("@tool.")) return;
          const match = value.match(/^@tool\.arguments\.([A-Za-z_][A-Za-z0-9_]*)$/);
          const parameter = match ? tool.parameters.find((candidate) => candidate.name === match[1]) : undefined;
          if (!parameter) {
            issues.push({
              id: `function-tool-argument-${node.id}-${binding.functionId}-${input.name}`,
              level: "error",
              title: "Tool Argument Is Unavailable",
              description: `${value} is not an argument of ${tool.displayName}.`,
              nodeId: node.id,
            });
            return;
          }
          if (!toolArgumentMatchesFunctionInput(parameter.type, input.type))
            issues.push({
              id: `function-input-type-${node.id}-${binding.functionId}-${input.name}`,
              level: "error",
              title: "Function Input Type Does Not Match",
              description: `${parameter.name} is ${parameter.type}, but ${input.name} expects ${input.type}.`,
              nodeId: node.id,
            });
        });
      }
    }
    if (node.data.kind === "tool" && !node.data.toolConfig?.toolId)
      issues.push({
        id: `tool-block-${node.id}`,
        level: "error",
        title: `Select a Tool for ${node.data.name}`,
        description: "Choose the GPT Realtime function schema handled at this step.",
        nodeId: node.id,
      });
    const routes = flow.edges.filter((edge) => edge.source === node.id);
    const alwaysRoutes = routes.filter((edge) => edge.data?.routeType === "always");
    const fallbacks = routes.filter((edge) => edge.data?.routeType === "fallback");
    if (alwaysRoutes.length > 1)
      issues.push({
        id: `always-conflict-${node.id}`,
        level: "error",
        title: `${node.data.name} Has Conflicting Routes`,
        description: "Keep only one Always Edge from this Node.",
        nodeId: node.id,
      });
    if (fallbacks.length > 1)
      issues.push({
        id: `fallback-${node.id}`,
        level: "error",
        title: `Check the Default Route for ${node.data.name}`,
        description: "A Node can have at most one Fallback Edge.",
        nodeId: node.id,
      });

    const conditionSignatures = new Map<string, string[]>();
    routes
      .filter((edge) => edge.data?.routeType === "condition" && edge.data.condition?.rules.length)
      .forEach((edge) => {
        const condition = edge.data!.condition!;
        const normalizedRules = condition.rules
          .map((rule) =>
            rule.kind === "timeout"
              ? `timeout\u0000${rule.timeoutMs ?? ""}`
              : `state\u0000${rule.path.trim()}\u0000${rule.comparator}\u0000${rule.value.trim()}`,
          )
          .sort();
        const signature = `${condition.logic}\u0001${normalizedRules.join("\u0002")}`;
        conditionSignatures.set(signature, [...(conditionSignatures.get(signature) ?? []), edge.id]);
      });
    if ([...conditionSignatures.values()].some((edgeIds) => edgeIds.length > 1))
      issues.push({
        id: `condition-conflict-${node.id}`,
        level: "error",
        title: `${node.data.name} Has Duplicate Conditions`,
        description: "Two or more Edges use the same condition. Make each route mutually exclusive.",
        nodeId: node.id,
      });

    const timeoutCounts = new Map<number, number>();
    routes
      .filter((edge) => edge.data?.routeType === "condition")
      .flatMap((edge) => edge.data?.condition?.rules ?? [])
      .filter((rule) => rule.kind === "timeout" && rule.timeoutMs)
      .forEach((rule) => timeoutCounts.set(rule.timeoutMs!, (timeoutCounts.get(rule.timeoutMs!) ?? 0) + 1));
    if ([...timeoutCounts.values()].some((count) => count > 1))
      issues.push({
        id: `timeout-conflict-${node.id}`,
        level: "error",
        title: `${node.data.name} Has Conflicting Timeouts`,
        description: "Two or more Timeout Edges use the same duration.",
        nodeId: node.id,
      });
  }

  if (!flow.nodes.some((node) => node.data.kind === "end"))
    issues.push({
      id: "missing-end",
      level: "error",
      title: "Missing End Block",
      description: "Add an End block to handle playback completion and disconnect the call.",
    });
  return issues;
}
