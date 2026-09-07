import type { Edge, Node } from "@xyflow/react";

export type NodeKind = "start" | "node" | "tool" | "end";
export type ResponseMode = "manual" | "automatic" | "none";
export type ToolChoiceMode = "none" | "auto" | "required";
export type NodeHealth = "ready" | "warning" | "draft";

export interface TurnDetectionConfig {
  type: "server_vad" | "semantic_vad";
  threshold: number;
  prefixPaddingMs: number;
  silenceDurationMs: number;
  eagerness: "low" | "medium" | "high" | "auto";
  createResponse: boolean;
  interruptResponse: boolean;
}

export interface TranscriptionConfig {
  enabled: boolean;
  model: "gpt-transcribe" | "gpt-live-transcribe";
  languages: string[];
  keywords: string[];
}

export interface StartConfig {
  model: "gpt-realtime-2.1";
  voice: "marin" | "cedar" | "coral" | "sage";
  speed: number;
  language: "ko" | "en";
  baseInstructions: string;
  inputFormat: "audio/pcmu";
  outputFormat: "audio/pcmu";
  initialInputGateMs: number;
  turnDetection: TurnDetectionConfig;
  transcription: TranscriptionConfig;
}

export interface NodeRuntimeConfig {
  responseMode: ResponseMode;
  toolChoice: ToolChoiceMode;
  parallelToolCalls: boolean;
  outputModalities: "audio" | "text";
  followUpAudio: boolean;
  speedOverride: number | null;
  vadSilenceOverrideMs: number | null;
  maxOutputTokens: number;
}

export interface ToolBlockConfig {
  toolId: string;
  execution: "runtime" | "model";
  timeoutMs: number;
  retryCount: number;
}

export interface ToolFunctionBinding {
  toolId: string;
  functionId: string;
  inputMappings: ToolFunctionInputMapping[];
}

export interface ToolFunctionInputMapping {
  inputName: string;
  value: string;
}

export interface ToolInputBinding {
  toolId: string;
  inputMappings: ToolRuntimeInputMapping[];
}

export interface ToolRuntimeInputMapping {
  inputName: string;
  value: string;
}

export interface EndConfig {
  finalMessage: string;
  waitForPlaybackMark: boolean;
  playbackTimeoutMs: number;
  fallbackGraceMs: number;
  saveTranscript: boolean;
  triggerResearchAgent: boolean;
  endReason: "completed" | "declined" | "timeout" | "safety";
}

export interface VoiceNodeData extends Record<string, unknown> {
  kind: NodeKind;
  name: string;
  description: string;
  objective: string;
  instructions: string;
  responseMode: ResponseMode;
  toolIds: string[];
  toolInputBindings?: ToolInputBinding[];
  toolFunctionBindings?: ToolFunctionBinding[];
  toolChoice: ToolChoiceMode;
  health: NodeHealth;
  startConfig?: StartConfig;
  runtime?: NodeRuntimeConfig;
  toolConfig?: ToolBlockConfig;
  endConfig?: EndConfig;
}

export type ConditionComparator =
  "equals" | "not_equals" | "contains" | "greater_than" | "greater_or_equal" | "less_than" | "less_or_equal";

export interface ConditionRule {
  id: string;
  kind?: "state" | "timeout";
  path: string;
  comparator: ConditionComparator;
  value: string;
  timeoutMs?: number;
}

export interface ConditionGroup {
  logic: "all" | "any";
  rules: ConditionRule[];
}

export interface RouteData extends Record<string, unknown> {
  name: string;
  /** `timeout` is accepted only while migrating legacy saved flows. */
  routeType: "always" | "condition" | "fallback" | "timeout";
  condition?: ConditionGroup;
  timeoutMs?: number;
  priority: number;
}

export type VoiceNode = Node<VoiceNodeData, "voiceNode">;
export type VoiceEdge = Edge<RouteData>;

export interface FlowDocument {
  schemaVersion: "2.0";
  id: string;
  name: string;
  description: string;
  stateSchemaId: string;
  version: number;
  status: "draft" | "published";
  entryNodeId: string;
  nodes: VoiceNode[];
  edges: VoiceEdge[];
  updatedAt: string;
}

export type ToolParameterItemType = "string" | "number" | "integer" | "boolean";
export type ToolParameterType = ToolParameterItemType | "array";

export interface DataReference {
  kind: "data";
  dataId: string;
  path: string;
}

export interface StateReference {
  kind: "state";
  schemaKey?: string;
  path: string;
}

export interface InputReference {
  kind: "input";
  inputKey: string;
  path: string;
}

export type ToolEnumValue = string | number | DataReference | StateReference | InputReference;

export type ToolInputType = "string" | "number" | "integer" | "boolean" | "array" | "object";

export interface ToolInput {
  id: string;
  displayName?: string;
  name: string;
  description: string;
  type: ToolInputType;
  required: boolean;
}

export interface ToolParameter {
  id: string;
  name: string;
  description: string;
  type: ToolParameterType;
  required: boolean;
  enumValues?: ToolEnumValue[];
  itemType?: ToolParameterItemType;
  uniqueItems?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  displayName: string;
  description: string;
  inputs?: ToolInput[];
  parameters: ToolParameter[];
  templateVersion?: number;
  updatedAt: string;
}

export interface PlatformSettings {
  connections: {
    publicUrl: string;
    telephonyIntegration: "media_streams" | "sip";
  };
  environmentVariables: {
    twilioAccountSid: string;
    twilioAuthToken: string;
    twilioPhoneNumber: string;
    openaiEndpoint: string;
    openaiApiKey: string;
  };
}

export interface ValidationIssue {
  id: string;
  level: "error" | "warning";
  title: string;
  description: string;
  nodeId?: string;
}

export interface CallRecord {
  id: string;
  person: string;
  phone: string;
  status: "completed" | "review" | "failed" | "live";
  startedAt: string;
  duration: string;
  flowVersion: string;
  turns: number;
  latency: number;
  path: string[];
}
