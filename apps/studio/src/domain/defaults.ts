import type { EndConfig, StartConfig, ToolBlockConfig, VoiceNodeData } from "./flow";

export const defaultStartConfig: StartConfig = {
  model: "gpt-realtime-2.1",
  voice: "marin",
  speed: 1,
  language: "ko",
  baseInstructions: `You are a helpful voice assistant.
- Speak clearly and keep each response concise.
- Ask one question at a time and allow the caller time to answer.
- Do not mention internal implementation details such as Tools, State, or Nodes.`,
  inputFormat: "audio/pcmu",
  outputFormat: "audio/pcmu",
  initialInputGateMs: 3000,
  turnDetection: {
    type: "server_vad",
    threshold: 0.5,
    prefixPaddingMs: 400,
    silenceDurationMs: 530,
    eagerness: "auto",
    createResponse: false,
    interruptResponse: true,
  },
  transcription: {
    enabled: true,
    model: "gpt-transcribe",
    languages: ["ko"],
    keywords: [],
  },
};

export const defaultEndConfig: EndConfig = {
  finalMessage: "Thank you for your time. Goodbye.",
  waitForPlaybackMark: true,
  playbackTimeoutMs: 8000,
  fallbackGraceMs: 1500,
  saveTranscript: true,
  triggerResearchAgent: false,
  endReason: "completed",
};

export const defaultToolBlockConfig: ToolBlockConfig = {
  toolId: "",
  execution: "runtime",
  timeoutMs: 5000,
  retryCount: 1,
};

export function createNodeData(): VoiceNodeData {
  return {
    kind: "node",
    name: "Node",
    description: "Configure the response, tools, and outgoing Edges.",
    objective: "Define the goal for this step.",
    instructions: "Describe the agent's behavior and tone.",
    responseMode: "manual",
    toolIds: [],
    toolChoice: "none",
    runtime: {
      responseMode: "manual",
      toolChoice: "none",
      parallelToolCalls: false,
      outputModalities: "audio",
      followUpAudio: false,
      speedOverride: null,
      vadSilenceOverrideMs: null,
      maxOutputTokens: 1024,
    },
    health: "draft",
  };
}
