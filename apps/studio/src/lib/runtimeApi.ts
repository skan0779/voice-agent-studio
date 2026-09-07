import type { FlowDocument, PlatformSettings, ToolDefinition } from "../domain/flow";
import type { ServiceFunction } from "../domain/functions";
import { serializeFlow } from "../domain/serialize";
import type { StateSchema } from "../domain/state";
import type { Contact, DataAsset, WorkspaceDocument } from "../domain/workspaces";

interface DeploymentInput {
  workspaceId: string;
  agent: FlowDocument;
  tools: ToolDefinition[];
  functions: ServiceFunction[];
  stateSchemas: StateSchema[];
  dataAssets: DataAsset[];
  settings: PlatformSettings;
  version: number;
}

export interface OutboundCallInput {
  agentId: string;
  toNumber: string;
  contact?: Pick<Contact, "id" | "name" | "photoDataUrl">;
}

export interface DeploymentRecord {
  id: string;
  workspace_id: string;
  agent_id: string;
  agent_name: string;
  version: number;
  active: boolean;
  created_at: string;
}

export interface WorkspaceDocumentRecord {
  workspace_id: string;
  document: unknown;
  updated_at: string;
}

export interface RuntimeCallRecord {
  id: string;
  workspace_id: string;
  agent_id: string;
  agent_name: string;
  deployment_id: string;
  from_number: string;
  to_number: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_photo_data_url: string | null;
  call_sid: string | null;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  duration_ms: number | null;
  turns: number;
  latency_ms: number | null;
  review: "safety" | "declined" | "incomplete" | null;
  path: string[];
  has_transcript: boolean;
  has_state: boolean;
}

export interface RuntimeLiveEvent {
  sequence: number;
  event: string;
  data: Record<string, unknown> & {
    runtime_call_id?: string;
    runtime_workspace_id?: string;
    runtime_agent_id?: string;
    runtime_agent_name?: string;
    runtime_contact_name?: string | null;
    runtime_to_number?: string;
  };
}

export interface ResearchReportEvent {
  sequence: number;
  event: "report_queued" | "report_running" | "report_completed" | "report_failed";
  data: {
    workspace_id: string;
    call_id: string;
    report_id: string;
    status: "queued" | "running" | "completed" | "failed";
    error?: string;
  };
}

export interface AssessmentAnswer {
  item_id: string;
  prompt: string;
  response_id: string;
  response_label: string;
  score: number;
}

export interface AssessmentResult {
  key: string;
  title: string;
  form: string;
  score: number;
  maximum: number;
  classification: string;
  complete: boolean;
  answered_count: number;
  required_count: number;
  answers: AssessmentAnswer[];
  domain_scores: Record<string, number>;
}

export interface ReportListItem {
  id: string | null;
  call_id: string;
  call_sid: string | null;
  workspace_id: string;
  agent_id: string;
  agent_name: string;
  contact_id: string | null;
  contact_name: string;
  contact_photo_data_url: string | null;
  to_number: string;
  call_started_at: string | null;
  status: "not_started" | "queued" | "running" | "completed" | "failed";
  generated_at: string | null;
  priority: "low" | "monitor" | "review" | null;
  summary: string | null;
  assessments: AssessmentResult[];
  error: string | null;
}

export interface ResearchReport extends Omit<
  ReportListItem,
  "status" | "generated_at" | "priority" | "summary" | "assessments" | "error"
> {
  id: string;
  generated_at: string;
  model: string;
  analysis_mode: "model" | "deterministic_fallback";
  priority: "low" | "monitor" | "review";
  summary: string;
  data_quality: "sufficient" | "limited";
  assessments: AssessmentResult[];
  evidence: Array<{
    domain: "mood" | "anxiety" | "social_connection" | "daily_life" | "protective_factor";
    finding: string;
    quote: string;
    turn_id: string;
  }>;
  strengths: string[];
  concerns: string[];
  longitudinal: Array<{
    assessment_key: string;
    form: string;
    previous_score: number;
    current_score: number;
    delta: number;
    direction: "improved" | "stable" | "worsened";
    previous_call_id: string;
  }>;
  disclaimer: string;
}

function runtimeBaseUrl() {
  const configured = import.meta.env.VITE_RUNTIME_API_URL;
  return (configured || "http://localhost:8080").replace(/\/$/, "");
}

function researchBaseUrl() {
  const configured = import.meta.env.VITE_RESEARCH_API_URL;
  return (configured || "http://localhost:8081").replace(/\/$/, "");
}

async function runtimeRequest<T>(path: string, init: RequestInit, timeoutMs?: number): Promise<T> {
  let response: Response;
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    response = await fetch(`${runtimeBaseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: controller?.signal ?? init.signal,
    });
  } catch {
    if (controller?.signal.aborted) {
      throw new Error("Twilio did not respond in time. Check the connection and try again.");
    }
    throw new Error("Could not reach the Voice Agent Runtime.");
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail =
      typeof payload?.detail === "string" ? payload.detail : `Runtime request failed (${response.status}).`;
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function researchRequest<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${researchBaseUrl()}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
    });
  } catch {
    throw new Error("Could not reach the Research Agent.");
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    throw new Error(
      typeof payload?.detail === "string" ? payload.detail : `Research request failed (${response.status}).`,
    );
  }
  return response.json() as Promise<T>;
}

export function deployAgent(input: DeploymentInput) {
  const referencedToolIds = new Set(input.agent.nodes.flatMap((node) => node.data.toolIds));
  const referencedFunctionIds = new Set(
    input.agent.nodes.flatMap((node) => (node.data.toolFunctionBindings ?? []).map((binding) => binding.functionId)),
  );
  const stateSchema = input.stateSchemas.find((schema) => schema.id === input.agent.stateSchemaId) ?? null;
  const deployedAgent = {
    ...input.agent,
    version: input.version,
    status: "published" as const,
    updatedAt: new Date().toISOString(),
  };
  return saveWorkspaceSettings(input.settings, input.workspaceId).then(() =>
    runtimeRequest<{ id: string; version: number }>("/api/deployments", {
      method: "POST",
      body: JSON.stringify({
        workspace_id: input.workspaceId,
        flow_spec: serializeFlow(deployedAgent),
        tools: input.tools.filter((tool) => referencedToolIds.has(tool.id)),
        functions: input.functions.filter((serviceFunction) => referencedFunctionIds.has(serviceFunction.id)),
        state_schema: stateSchema,
        data_assets: input.dataAssets,
      }),
    }),
  );
}

export function saveWorkspaceSettings(settings: PlatformSettings, workspaceId: string) {
  return runtimeRequest<{
    workspace_id: string;
    twilio_auth_token_configured: boolean;
    openai_api_key_configured: boolean;
  }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function listWorkspaceDocuments() {
  return runtimeRequest<WorkspaceDocumentRecord[]>("/api/workspaces", {
    method: "GET",
  });
}

export function saveWorkspaceDocument(workspace: WorkspaceDocument) {
  const document = structuredClone(workspace);
  document.settings.environmentVariables.twilioAuthToken = "";
  document.settings.environmentVariables.openaiApiKey = "";
  return runtimeRequest<WorkspaceDocumentRecord>(`/api/workspaces/${encodeURIComponent(workspace.id)}`, {
    method: "PUT",
    body: JSON.stringify({ document }),
  });
}

export function deleteWorkspaceDocument(workspaceId: string) {
  return runtimeRequest<void>(`/api/workspaces/${encodeURIComponent(workspaceId)}`, { method: "DELETE" });
}

export function startOutboundCall(_settings: PlatformSettings, input: OutboundCallInput) {
  return runtimeRequest<{ call_sid: string | null; status: string }>(
    "/api/outbound-calls",
    {
      method: "POST",
      body: JSON.stringify({
        agent_id: input.agentId,
        to_number: input.toNumber,
        contact_id: input.contact?.id ?? null,
        contact_name: input.contact?.name ?? null,
        contact_photo_data_url: input.contact?.photoDataUrl || null,
      }),
    },
    20_000,
  );
}

export function listDeployments(_settings: PlatformSettings, workspaceId: string) {
  return runtimeRequest<DeploymentRecord[]>(`/api/deployments?workspace_id=${encodeURIComponent(workspaceId)}`, {
    method: "GET",
  });
}

export function listCallRecords(workspaceId: string) {
  return runtimeRequest<RuntimeCallRecord[]>(`/api/call-records?workspace_id=${encodeURIComponent(workspaceId)}`, {
    method: "GET",
  });
}

export function getCallArtifact(callId: string, artifact: "transcript" | "state") {
  return runtimeRequest<Record<string, unknown>>(`/api/call-records/${encodeURIComponent(callId)}/${artifact}`, {
    method: "GET",
  });
}

export function deleteCallRecord(callId: string) {
  return runtimeRequest<void>(`/api/call-records/${encodeURIComponent(callId)}`, { method: "DELETE" });
}

export function listReports(workspaceId: string) {
  return researchRequest<ReportListItem[]>(`/api/reports?workspace_id=${encodeURIComponent(workspaceId)}`, {
    method: "GET",
  });
}

export function getReport(reportId: string) {
  return researchRequest<ResearchReport>(`/api/reports/${encodeURIComponent(reportId)}`, { method: "GET" });
}

export function analyzeCall(callId: string, force = false) {
  return researchRequest<{ call_id: string; status: "queued" | "already_completed" }>(
    `/api/reports/analyze/${encodeURIComponent(callId)}?force=${force}`,
    { method: "POST" },
  );
}

export function analyzePendingReports(workspaceId: string) {
  return researchRequest<{ queued: number }>(
    `/api/reports/analyze-pending?workspace_id=${encodeURIComponent(workspaceId)}`,
    { method: "POST" },
  );
}

export function subscribeToLiveEvents(
  workspaceId: string,
  handlers: {
    onEvent: (event: RuntimeLiveEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  },
) {
  const url = `${runtimeBaseUrl()}/api/live-events?workspace_id=${encodeURIComponent(workspaceId)}`;
  const source = new EventSource(url);
  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => handlers.onError?.();
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as RuntimeLiveEvent);
    } catch {
      // Ignore malformed observability events without interrupting the call UI.
    }
  };
  return () => source.close();
}

export function subscribeToReportEvents(
  workspaceId: string,
  handlers: {
    onEvent: (event: ResearchReportEvent) => void;
    onOpen?: () => void;
    onError?: () => void;
  },
) {
  const url = `${researchBaseUrl()}/api/report-events?workspace_id=${encodeURIComponent(workspaceId)}`;
  const source = new EventSource(url);
  source.onopen = () => handlers.onOpen?.();
  source.onerror = () => handlers.onError?.();
  source.onmessage = (message) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as ResearchReportEvent);
    } catch {
      // Ignore malformed lifecycle events and recover from the next event or page load.
    }
  };
  return () => source.close();
}
