import { defaultEndConfig, defaultStartConfig } from "../domain/defaults";
import type { CallRecord, FlowDocument, PlatformSettings, ToolDefinition, VoiceNode } from "../domain/flow";
import type { ServiceFunction } from "../domain/functions";
import { defaultPlatformSettings } from "../domain/settings";
import type { StateSchema } from "../domain/state";
import type { DataAsset } from "../domain/workspaces";

const node = (id: string, x: number, y: number, data: VoiceNode["data"]): VoiceNode => ({
  id,
  type: "voiceNode",
  position: { x, y },
  data,
});

export const fixtureTools: ToolDefinition[] = [
  {
    id: "collect_choice",
    name: "collect_choice",
    displayName: "Collect Choice",
    description: "Collect a structured choice from the caller.",
    inputs: [
      {
        id: "input-options",
        name: "options",
        description: "Choices available for the current step.",
        type: "array",
        required: true,
      },
    ],
    parameters: [
      {
        id: "parameter-choice",
        name: "choice",
        description: "The selected choice.",
        type: "string",
        required: true,
        enumValues: ["continue", "finish"],
      },
    ],
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const fixtureFunctions: ServiceFunction[] = [
  {
    id: "function-apply-choice",
    name: "Apply Choice",
    key: "apply_choice",
    description: "Store the caller's selected choice.",
    inputs: [
      {
        id: "function-input-choice",
        name: "choice",
        description: "The selected choice.",
        type: "string",
        required: true,
      },
    ],
    actions: [
      {
        id: "action-store-choice",
        type: "state",
        updates: [
          {
            id: "update-choice",
            target: "@state.session.choice",
            method: "replace",
            value: "@inputs.choice",
          },
        ],
        outputName: "",
        resultKey: "",
        code: "",
      },
    ],
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const fixtureStateSchemas: StateSchema[] = [
  {
    id: "state-example",
    name: "Example State",
    key: "example_state",
    description: "State used by generic domain tests.",
    groups: [
      {
        id: "group-session",
        displayName: "Session",
        key: "session",
        fields: [
          {
            id: "field-choice",
            displayName: "Choice",
            key: "choice",
            description: "The caller's selected choice.",
            type: "string",
            defaultValue: "",
            enumValues: ["continue", "finish"],
            updateMethod: "replace",
            readOnly: false,
          },
          {
            id: "field-attempts",
            displayName: "Attempts",
            key: "attempts",
            description: "Number of collection attempts.",
            type: "integer",
            defaultValue: 0,
            updateMethod: "increment",
            readOnly: false,
          },
        ],
      },
    ],
    schemaVersion: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export const fixtureFlow: FlowDocument = {
  schemaVersion: "2.0",
  id: "agent-example",
  name: "Example Agent",
  description: "A generic voice-agent test fixture.",
  stateSchemaId: "state-example",
  version: 1,
  status: "draft",
  entryNodeId: "start_00000001",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nodes: [
    node("start_00000001", 80, 180, {
      kind: "start",
      name: "Start",
      description: "",
      objective: "Open the realtime session.",
      instructions: "",
      responseMode: "none",
      toolIds: [],
      toolChoice: "none",
      startConfig: structuredClone(defaultStartConfig),
      health: "ready",
    }),
    node("node_00000001", 420, 180, {
      kind: "node",
      name: "Collect Choice",
      description: "Ask the caller to select an option.",
      objective: "Collect one structured choice.",
      instructions: "Ask the caller whether to continue or finish.",
      responseMode: "manual",
      toolIds: ["collect_choice"],
      toolInputBindings: [
        {
          toolId: "collect_choice",
          inputMappings: [{ inputName: "options", value: '["continue", "finish"]' }],
        },
      ],
      toolFunctionBindings: [
        {
          toolId: "collect_choice",
          functionId: "function-apply-choice",
          inputMappings: [{ inputName: "choice", value: "@tool.arguments.choice" }],
        },
      ],
      toolChoice: "required",
      runtime: {
        responseMode: "manual",
        toolChoice: "required",
        parallelToolCalls: false,
        outputModalities: "text",
        followUpAudio: true,
        speedOverride: null,
        vadSilenceOverrideMs: null,
        maxOutputTokens: 512,
      },
      health: "ready",
    }),
    node("end_00000001", 780, 180, {
      kind: "end",
      name: "End",
      description: "End the call.",
      objective: "Close the session.",
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
      id: "edge-start-collect",
      source: "start_00000001",
      target: "node_00000001",
      sourceHandle: "right",
      targetHandle: "left",
      type: "smoothstep",
      data: { name: "Begin", routeType: "always", priority: 1 },
    },
    {
      id: "edge-collect-end",
      source: "node_00000001",
      target: "end_00000001",
      sourceHandle: "right",
      targetHandle: "left",
      type: "smoothstep",
      data: {
        name: "Finish",
        routeType: "condition",
        priority: 1,
        condition: {
          logic: "all",
          rules: [
            {
              id: "rule-finish",
              kind: "state",
              path: "@state.session.choice",
              comparator: "equals",
              value: "finish",
            },
          ],
        },
      },
    },
  ],
};

export const fixtureDataAssets: DataAsset[] = [];
export const fixtureCalls: CallRecord[] = [];
export const fixturePlatformSettings: PlatformSettings = structuredClone(defaultPlatformSettings);
