import { AlertCircle, Check, LoaderCircle, Rocket, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FlowDocument, PlatformSettings, ToolDefinition } from "./domain/flow";
import { createAgentFlow, duplicateAgentFlow, migrationFallbackFlow } from "./domain/agents";
import {
  createWorkspace,
  createDefaultWorkspace,
  duplicateWorkspace,
  migrateWorkspaces,
  type Contact,
  type DataAsset,
  type WorkspaceDocument,
} from "./domain/workspaces";
import { defaultPlatformSettings } from "./domain/settings";
import { validateFlow } from "./domain/validation";
import { FlowBuilder } from "./components/builder/FlowBuilder";
import { Sidebar, type SectionId } from "./components/Sidebar";
import { TopHeader } from "./components/TopHeader";
import { OverviewScreen } from "./components/screens/OverviewScreen";
import { CallsScreen } from "./components/screens/CallsScreen";
import { ReportsScreen } from "./components/screens/ReportsScreen";
import { ContactsScreen } from "./components/screens/ContactsScreen";
import { CallLiveScreen } from "./components/screens/CallLiveScreen";
import { ToolsScreen } from "./components/screens/ToolsScreen";
import { DeploymentsScreen } from "./components/screens/DeploymentsScreen";
import { SettingsScreen } from "./components/screens/SettingsScreen";
import { AgentsScreen } from "./components/screens/AgentsScreen";
import { WorkspacesScreen } from "./components/screens/WorkspacesScreen";
import { DataScreen } from "./components/screens/DataScreen";
import { FunctionsScreen } from "./components/screens/FunctionsScreen";
import { StateScreen } from "./components/screens/StateScreen";
import { HelpScreen } from "./components/screens/HelpScreen";
import { Dialog } from "./components/ui/Dialog";
import { Button } from "./components/ui/Button";
import type { StateSchema } from "./domain/state";
import { collectStatePathRenames, renameStateBindingKey, renameStateBindingPaths } from "./domain/stateReferences";
import type { ServiceFunction } from "./domain/functions";
import {
  deployAgent,
  deleteWorkspaceDocument,
  listCallRecords,
  listReports,
  listWorkspaceDocuments,
  saveWorkspaceDocument,
  saveWorkspaceSettings,
  startOutboundCall,
  subscribeToReportEvents,
  type ResearchReportEvent,
} from "./lib/runtimeApi";

const ACTIVE_WORKSPACE_KEY = "voice-agent-studio.active-workspace.v1";
const WORKSPACE_SECRETS_KEY = "voice-agent-studio.workspace-secrets.v1";
const THEME_KEY = "voice-agent-studio.theme";

type WorkspaceLoadStatus = "loading" | "ready" | "error";
type WorkspaceSecrets = Record<string, { twilioAuthToken?: unknown; openaiApiKey?: unknown }>;

function readWorkspaceSecrets(): WorkspaceSecrets {
  try {
    return JSON.parse(sessionStorage.getItem(WORKSPACE_SECRETS_KEY) ?? "{}") as WorkspaceSecrets;
  } catch {
    return {};
  }
}

function hydrateWorkspaceSecrets(workspaces: WorkspaceDocument[]): WorkspaceDocument[] {
  const secrets = readWorkspaceSecrets();
  return workspaces.map((workspace) => {
    const workspaceSecrets = secrets[workspace.id];
    const twilioAuthToken = workspaceSecrets?.twilioAuthToken;
    const openaiApiKey = workspaceSecrets?.openaiApiKey;
    return {
      ...workspace,
      settings: {
        ...workspace.settings,
        environmentVariables: {
          ...workspace.settings.environmentVariables,
          twilioAuthToken: typeof twilioAuthToken === "string" ? twilioAuthToken : "",
          openaiApiKey: typeof openaiApiKey === "string" ? openaiApiKey : "",
        },
      },
    };
  });
}

function withoutWorkspaceSecrets(workspace: WorkspaceDocument): WorkspaceDocument {
  return {
    ...workspace,
    settings: {
      ...workspace.settings,
      environmentVariables: {
        ...workspace.settings.environmentVariables,
        twilioAuthToken: "",
        openaiApiKey: "",
      },
    },
  };
}

function workspaceSnapshot(workspaces: WorkspaceDocument[]) {
  return JSON.stringify(workspaces.map(withoutWorkspaceSecrets));
}

export default function App() {
  const [section, setSection] = useState<SectionId>("overview");
  const [workspaces, setWorkspaces] = useState<WorkspaceDocument[]>([]);
  const [workspaceLoadStatus, setWorkspaceLoadStatus] = useState<WorkspaceLoadStatus>("loading");
  const [workspaceLoadError, setWorkspaceLoadError] = useState<string | null>(null);
  const [workspaceSaveError, setWorkspaceSaveError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_WORKSPACE_KEY),
  );
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) === "dark");
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [runtimeCallCount, setRuntimeCallCount] = useState(0);
  const [runtimeLiveCallCount, setRuntimeLiveCallCount] = useState(0);
  const [runtimeReportCount, setRuntimeReportCount] = useState(0);
  const [latestReportEvent, setLatestReportEvent] = useState<ResearchReportEvent | null>(null);
  const lastWorkspaceSnapshotRef = useRef("");
  const workspaceSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const refreshCallCounts = useCallback(async (workspaceId: string, cancelled?: () => boolean) => {
    try {
      const records = await listCallRecords(workspaceId);
      if (cancelled?.()) return;
      setRuntimeCallCount(records.length);
      setRuntimeLiveCallCount(
        records.filter((call) => ["preparing", "queued", "initiated", "ringing", "in-progress"].includes(call.status))
          .length,
      );
    } catch {
      if (cancelled?.()) return;
      setRuntimeCallCount(0);
      setRuntimeLiveCallCount(0);
    }
  }, []);

  const refreshReportCount = useCallback(async (workspaceId: string, cancelled?: () => boolean) => {
    try {
      const reports = await listReports(workspaceId);
      if (cancelled?.()) return;
      setRuntimeReportCount(reports.filter((report) => report.status === "completed").length);
    } catch {
      if (cancelled?.()) return;
      setRuntimeReportCount(0);
    }
  }, []);

  const refreshRuntimeCounts = useCallback(
    (workspaceId: string, cancelled?: () => boolean) =>
      Promise.all([refreshCallCounts(workspaceId, cancelled), refreshReportCount(workspaceId, cancelled)]),
    [refreshCallCounts, refreshReportCount],
  );
  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? workspaces[0] ?? null,
    [activeWorkspaceId, workspaces],
  );
  const agents = activeWorkspace?.agents ?? [];
  const activeAgent = useMemo(
    () => agents.find((agent) => agent.id === activeAgentId) ?? null,
    [activeAgentId, agents],
  );
  const issues = useMemo(
    () => (activeAgent ? validateFlow(activeAgent, activeWorkspace?.stateSchemas ?? []) : []),
    [activeAgent, activeWorkspace?.stateSchemas],
  );

  const loadWorkspaceState = useCallback(async () => {
    setWorkspaceLoadStatus("loading");
    setWorkspaceLoadError(null);
    try {
      const records = await listWorkspaceDocuments();
      const migrated = migrateWorkspaces(
        records.map((record) => record.document),
        migrationFallbackFlow,
        defaultPlatformSettings,
      );
      const loadedWorkspaces = migrated.length > 0 ? migrated : [createDefaultWorkspace(defaultPlatformSettings)];
      if (migrated.length === 0) await saveWorkspaceDocument(loadedWorkspaces[0]);
      const hydrated = hydrateWorkspaceSecrets(loadedWorkspaces);
      const storedWorkspaceId = localStorage.getItem(ACTIVE_WORKSPACE_KEY);
      const initialWorkspace = hydrated.find((workspace) => workspace.id === storedWorkspaceId) ?? hydrated[0];
      lastWorkspaceSnapshotRef.current = workspaceSnapshot(hydrated);
      setWorkspaces(hydrated);
      setActiveWorkspaceId(initialWorkspace.id);
      setActiveAgentId(null);
      setSection("overview");
      setWorkspaceLoadStatus("ready");
    } catch (error) {
      setWorkspaceLoadError(error instanceof Error ? error.message : "Could not load workspaces.");
      setWorkspaceLoadStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceState();
  }, [loadWorkspaceState]);

  useEffect(() => {
    if (workspaceLoadStatus !== "ready") return;
    const snapshot = workspaceSnapshot(workspaces);
    if (snapshot === lastWorkspaceSnapshotRef.current) return;
    const documents = workspaces.map(withoutWorkspaceSecrets);
    const timeout = window.setTimeout(() => {
      workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          await Promise.all(documents.map(saveWorkspaceDocument));
          lastWorkspaceSnapshotRef.current = snapshot;
          setWorkspaceSaveError(null);
        })
        .catch((error) => {
          setWorkspaceSaveError(error instanceof Error ? error.message : "Could not save workspace changes.");
        });
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [workspaceLoadStatus, workspaces]);

  useEffect(() => {
    if (workspaceLoadStatus !== "ready") return;
    sessionStorage.setItem(
      WORKSPACE_SECRETS_KEY,
      JSON.stringify(
        Object.fromEntries(
          workspaces.map((workspace) => [
            workspace.id,
            {
              twilioAuthToken: workspace.settings.environmentVariables.twilioAuthToken,
              openaiApiKey: workspace.settings.environmentVariables.openaiApiKey,
            },
          ]),
        ),
      ),
    );
  }, [workspaceLoadStatus, workspaces]);

  useEffect(() => {
    if (workspaceLoadStatus !== "ready") return;
    if (!activeWorkspace) {
      localStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      if (activeWorkspaceId !== null) setActiveWorkspaceId(null);
      if (section !== "workspaces") setSection("workspaces");
      return;
    }
    if (activeWorkspaceId !== activeWorkspace.id) setActiveWorkspaceId(activeWorkspace.id);
    localStorage.setItem(ACTIVE_WORKSPACE_KEY, activeWorkspace.id);
  }, [activeWorkspace, activeWorkspaceId, section, workspaceLoadStatus]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!activeWorkspace) {
      setRuntimeCallCount(0);
      setRuntimeLiveCallCount(0);
      setRuntimeReportCount(0);
      return;
    }
    let cancelled = false;
    const refreshCounts = () => void refreshRuntimeCounts(activeWorkspace.id, () => cancelled);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshCounts();
    };
    refreshCounts();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [activeWorkspace?.id, refreshRuntimeCounts]);

  useEffect(() => {
    if (!activeWorkspace) {
      setLatestReportEvent(null);
      return;
    }
    return subscribeToReportEvents(activeWorkspace.id, {
      onEvent: (event) => {
        setLatestReportEvent(event);
        if (event.event === "report_completed") void refreshReportCount(activeWorkspace.id);
      },
    });
  }, [activeWorkspace?.id, refreshReportCount]);

  const publish = async () => {
    if (!activeAgent || !activeWorkspace) return;
    const isUpdate = activeAgent.status === "published";
    const nextVersion = activeAgent.version + 1;
    setPublishing(true);
    setPublishError(null);
    try {
      await deployAgent({
        workspaceId: activeWorkspace.id,
        agent: activeAgent,
        tools: activeWorkspace.tools,
        functions: activeWorkspace.functions,
        stateSchemas: activeWorkspace.stateSchemas,
        dataAssets: activeWorkspace.dataAssets,
        settings: activeWorkspace.settings,
        version: nextVersion,
      });
      const deployedAt = new Date().toISOString();
      setWorkspaces((current) =>
        current.map((workspace) =>
          workspace.id === activeWorkspace.id
            ? {
                ...workspace,
                agents: workspace.agents.map((agent) =>
                  agent.id === activeAgent.id
                    ? {
                        ...agent,
                        version: nextVersion,
                        status: "published",
                        updatedAt: deployedAt,
                      }
                    : agent,
                ),
                updatedAt: deployedAt,
              }
            : workspace,
        ),
      );
      setPublishOpen(false);
      setToast(
        isUpdate ? `${activeAgent.name} deployment has been updated.` : `${activeAgent.name} has been deployed.`,
      );
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "Deployment failed.");
    } finally {
      setPublishing(false);
    }
  };

  const openAgentLibrary = () => {
    setSection("builder");
    setActiveAgentId(null);
  };
  const changeSection = (nextSection: SectionId) => {
    if (!activeWorkspace && nextSection !== "workspaces" && nextSection !== "help") {
      setSection("workspaces");
      return;
    }
    setSection(nextSection);
    if (nextSection === "builder") setActiveAgentId(null);
  };
  const updateActiveAgent = (flow: FlowDocument) => {
    if (!activeWorkspace) return;
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              agents: workspace.agents.map((agent) => (agent.id === flow.id ? flow : agent)),
              updatedAt: flow.updatedAt,
            }
          : workspace,
      ),
    );
    setToast("Agent saved.");
  };
  const createAgent = (name: string, description: string) => {
    if (!activeWorkspace) return;
    const agent = createAgentFlow(name, description);
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, agents: [...workspace.agents, agent], updatedAt: agent.updatedAt }
          : workspace,
      ),
    );
    setActiveAgentId(agent.id);
    setToast(`${agent.name} created.`);
  };
  const updateAgentDetails = (agentId: string, name: string, description: string) => {
    if (!activeWorkspace) return;
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              agents: workspace.agents.map((agent) =>
                agent.id === agentId
                  ? { ...agent, name: name.trim(), description: description.trim(), updatedAt }
                  : agent,
              ),
              updatedAt,
            }
          : workspace,
      ),
    );
    setToast("Agent details updated.");
  };
  const duplicateAgent = (agentId: string) => {
    if (!activeWorkspace) return;
    const source = agents.find((agent) => agent.id === agentId);
    if (!source) return;
    const duplicate = duplicateAgentFlow(source);
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, agents: [...workspace.agents, duplicate], updatedAt: duplicate.updatedAt }
          : workspace,
      ),
    );
    setToast(`${duplicate.name} created.`);
  };
  const deleteAgent = (agentId: string) => {
    if (!activeWorkspace) return;
    const target = agents.find((agent) => agent.id === agentId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, agents: workspace.agents.filter((agent) => agent.id !== agentId), updatedAt }
          : workspace,
      ),
    );
    if (activeAgentId === agentId) setActiveAgentId(null);
    if (target) setToast(`${target.name} deleted.`);
  };

  const selectWorkspace = (workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
    setActiveAgentId(null);
    setSection("builder");
  };
  const createNewWorkspace = (name: string, description: string) => {
    const workspace = createWorkspace(name, description, defaultPlatformSettings);
    setWorkspaces((current) => [...current, workspace]);
    selectWorkspace(workspace.id);
    setToast(`${workspace.name} created.`);
  };
  const updateWorkspaceDetails = (workspaceId: string, name: string, description: string) => {
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, name: name.trim(), description: description.trim(), updatedAt: new Date().toISOString() }
          : workspace,
      ),
    );
    setToast("Workspace details updated.");
  };
  const copyWorkspace = (workspaceId: string) => {
    const source = workspaces.find((workspace) => workspace.id === workspaceId);
    if (!source) return;
    const copy = duplicateWorkspace(source, defaultPlatformSettings);
    setWorkspaces((current) => [...current, copy]);
    setToast(`${copy.name} created.`);
  };
  const deleteWorkspace = (workspaceId: string) => {
    const target = workspaces.find((workspace) => workspace.id === workspaceId);
    const remaining = workspaces.filter((workspace) => workspace.id !== workspaceId);
    workspaceSaveQueueRef.current = workspaceSaveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await deleteWorkspaceDocument(workspaceId);
        setWorkspaceSaveError(null);
      })
      .catch((error) => {
        setWorkspaceSaveError(error instanceof Error ? error.message : "Could not delete the workspace.");
      });
    setWorkspaces(remaining);
    if (activeWorkspace?.id === workspaceId) setActiveWorkspaceId(remaining[0]?.id ?? null);
    setActiveAgentId(null);
    setSection("workspaces");
    if (target) setToast(`${target.name} deleted.`);
  };
  const updateWorkspaceSettings = (settings: PlatformSettings) => {
    if (!activeWorkspace) return;
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, settings, updatedAt: new Date().toISOString() }
          : workspace,
      ),
    );
  };
  const createDataAsset = (asset: Omit<DataAsset, "updatedAt">) => {
    if (!activeWorkspace) return;
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              dataAssets: [...workspace.dataAssets.filter((item) => item.id !== asset.id), { ...asset, updatedAt }],
              updatedAt,
            }
          : workspace,
      ),
    );
    setToast(`${asset.name} added.`);
  };
  const deleteDataAsset = (assetId: string) => {
    if (!activeWorkspace) return;
    const target = activeWorkspace.dataAssets.find((asset) => asset.id === assetId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, dataAssets: workspace.dataAssets.filter((asset) => asset.id !== assetId), updatedAt }
          : workspace,
      ),
    );
    if (target) setToast(`${target.name} deleted.`);
  };
  const saveContact = (contact: Contact) => {
    if (!activeWorkspace) return;
    const exists = activeWorkspace.contacts.some((item) => item.id === contact.id);
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              contacts: exists
                ? workspace.contacts.map((item) => (item.id === contact.id ? contact : item))
                : [...workspace.contacts, contact],
              updatedAt: contact.updatedAt,
            }
          : workspace,
      ),
    );
    setToast(`${contact.name} ${exists ? "updated" : "added"}.`);
  };
  const deleteContact = (contactId: string) => {
    if (!activeWorkspace) return;
    const target = activeWorkspace.contacts.find((contact) => contact.id === contactId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              contacts: workspace.contacts.filter((contact) => contact.id !== contactId),
              updatedAt,
            }
          : workspace,
      ),
    );
    if (target) setToast(`${target.name} deleted.`);
  };
  const saveTool = (tool: Omit<ToolDefinition, "updatedAt">) => {
    if (!activeWorkspace) return;
    const updatedAt = new Date().toISOString();
    const exists = activeWorkspace.tools.some((item) => item.id === tool.id);
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              tools: exists
                ? workspace.tools.map((item) => (item.id === tool.id ? { ...tool, updatedAt } : item))
                : [...workspace.tools, { ...tool, updatedAt }],
              updatedAt,
            }
          : workspace,
      ),
    );
    setToast(`${tool.displayName} ${exists ? "updated" : "added"}.`);
  };
  const deleteTool = (toolId: string) => {
    if (!activeWorkspace) return;
    const target = activeWorkspace.tools.find((tool) => tool.id === toolId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              tools: workspace.tools.filter((tool) => tool.id !== toolId),
              agents: workspace.agents.map((agent) => ({
                ...agent,
                nodes: agent.nodes.map((node) => ({
                  ...node,
                  data: {
                    ...node.data,
                    toolIds: node.data.toolIds.filter((id) => id !== toolId),
                    toolInputBindings: (node.data.toolInputBindings ?? []).filter(
                      (binding) => binding.toolId !== toolId,
                    ),
                    toolFunctionBindings: (node.data.toolFunctionBindings ?? []).filter(
                      (binding) => binding.toolId !== toolId,
                    ),
                    ...(node.data.toolConfig?.toolId === toolId
                      ? { toolConfig: { ...node.data.toolConfig, toolId: "" } }
                      : {}),
                  },
                })),
                updatedAt,
              })),
              updatedAt,
            }
          : workspace,
      ),
    );
    if (target) setToast(`${target.displayName} deleted.`);
  };
  const saveFunction = (serviceFunction: ServiceFunction) => {
    if (!activeWorkspace) return;
    const updatedAt = new Date().toISOString();
    const normalized = { ...serviceFunction, updatedAt };
    const exists = activeWorkspace.functions.some((item) => item.id === serviceFunction.id);
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              functions: exists
                ? workspace.functions.map((item) => (item.id === serviceFunction.id ? normalized : item))
                : [...workspace.functions, normalized],
              updatedAt,
            }
          : workspace,
      ),
    );
    setToast(`${serviceFunction.name} ${exists ? "updated" : "created"}.`);
  };
  const deleteFunction = (functionId: string) => {
    if (!activeWorkspace) return;
    const target = activeWorkspace.functions.find((item) => item.id === functionId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              functions: workspace.functions.filter((item) => item.id !== functionId),
              agents: workspace.agents.map((agent) => ({
                ...agent,
                nodes: agent.nodes.map((node) => ({
                  ...node,
                  data: {
                    ...node.data,
                    toolFunctionBindings: (node.data.toolFunctionBindings ?? []).filter(
                      (binding) => binding.functionId !== functionId,
                    ),
                  },
                })),
                updatedAt,
              })),
              updatedAt,
            }
          : workspace,
      ),
    );
    if (target) setToast(`${target.name} deleted.`);
  };
  const saveStateSchema = (schema: StateSchema) => {
    if (!activeWorkspace) return;
    const updatedAt = new Date().toISOString();
    const normalized = { ...schema, updatedAt };
    const previous = activeWorkspace.stateSchemas.find((item) => item.id === schema.id);
    const exists = Boolean(previous);
    const keyChanged = Boolean(previous && previous.key !== normalized.key);
    const pathRenames = previous ? collectStatePathRenames(previous, normalized) : [];
    const bindingsChanged = keyChanged || pathRenames.length > 0;
    const migrateBindings = <T,>(value: T) => {
      const schemaMigrated = keyChanged ? renameStateBindingKey(value, previous!.key, normalized.key) : value;
      return renameStateBindingPaths(schemaMigrated, pathRenames);
    };
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? {
              ...workspace,
              stateSchemas: exists
                ? workspace.stateSchemas.map((item) => (item.id === schema.id ? normalized : item))
                : [...workspace.stateSchemas, normalized],
              tools: bindingsChanged ? migrateBindings(workspace.tools) : workspace.tools,
              functions: bindingsChanged ? migrateBindings(workspace.functions) : workspace.functions,
              agents: exists
                ? workspace.agents.map((agent) => {
                    const migrated =
                      agent.stateSchemaId === schema.id && bindingsChanged ? migrateBindings(agent) : agent;
                    return agent.stateSchemaId === schema.id ? { ...migrated, updatedAt } : migrated;
                  })
                : workspace.agents,
              updatedAt,
            }
          : workspace,
      ),
    );
    setToast(`${schema.name} ${exists ? "updated" : "created"}.`);
  };
  const deleteStateSchema = (schemaId: string) => {
    if (!activeWorkspace || activeWorkspace.agents.some((agent) => agent.stateSchemaId === schemaId)) return;
    const target = activeWorkspace.stateSchemas.find((schema) => schema.id === schemaId);
    const updatedAt = new Date().toISOString();
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === activeWorkspace.id
          ? { ...workspace, stateSchemas: workspace.stateSchemas.filter((schema) => schema.id !== schemaId), updatedAt }
          : workspace,
      ),
    );
    if (target) setToast(`${target.name} deleted.`);
  };

  return (
    <div className="flex h-dvh min-h-[640px] overflow-hidden bg-[var(--app-bg)] text-[var(--text)]">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-4 z-[200] rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-bold text-white focus:not-sr-only"
      >
        Skip to main content
      </a>
      <Sidebar
        active={section}
        workspaceName={activeWorkspace?.name ?? null}
        workspaceDescription={activeWorkspace?.description ?? null}
        counts={{
          builder: activeWorkspace?.agents.length ?? 0,
          tools: activeWorkspace?.tools.length ?? 0,
          functions: activeWorkspace?.functions.length ?? 0,
          state: activeWorkspace?.stateSchemas.length ?? 0,
          data: activeWorkspace?.dataAssets.length ?? 0,
          deployments: activeWorkspace?.agents.filter((agent) => agent.status === "published").length ?? 0,
          contacts: activeWorkspace?.contacts.length ?? 0,
          live: runtimeLiveCallCount,
          calls: runtimeCallCount,
          reports: runtimeReportCount,
        }}
        onChange={changeSection}
        onOpenWorkspaces={() => {
          setSection("workspaces");
          setActiveAgentId(null);
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopHeader
          section={section}
          title={section === "builder" && activeAgent ? activeAgent.name : undefined}
          eyebrow={section === "builder" && activeAgent ? "Agent Builder / Flow" : undefined}
          dark={dark}
          onToggleTheme={() => setDark((value) => !value)}
        />
        {workspaceLoadStatus === "loading" && (
          <main id="main-content" className="flex min-h-0 flex-1 items-center justify-center bg-[var(--app-bg)] p-6">
            <div className="text-center">
              <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-[var(--blue)]" />
              <p className="mt-3 text-sm font-bold text-[var(--text)]">Loading workspaces</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Connecting to the Runtime database.</p>
            </div>
          </main>
        )}
        {workspaceLoadStatus === "error" && (
          <main id="main-content" className="flex min-h-0 flex-1 items-center justify-center bg-[var(--app-bg)] p-6">
            <div className="w-full max-w-md rounded-2xl border border-[var(--red-border)] bg-[var(--surface)] p-6 text-center shadow-sm">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--red-soft)] text-[var(--red)]">
                <AlertCircle className="h-5 w-5" />
              </div>
              <h2 className="mt-4 text-base font-extrabold text-[var(--text)]">Could not load workspaces</h2>
              <p className="mt-2 text-xs leading-5 text-[var(--text-muted)]">{workspaceLoadError}</p>
              <Button variant="primary" className="mt-5" onClick={() => void loadWorkspaceState()}>
                Retry
              </Button>
            </div>
          </main>
        )}
        {workspaceLoadStatus === "ready" && (
          <>
            {section === "workspaces" && (
              <WorkspacesScreen
                workspaces={workspaces}
                activeWorkspaceId={activeWorkspace?.id ?? null}
                onSelect={selectWorkspace}
                onCreate={createNewWorkspace}
                onUpdate={updateWorkspaceDetails}
                onDuplicate={copyWorkspace}
                onDelete={deleteWorkspace}
              />
            )}
            {section === "overview" && activeWorkspace && (
              <OverviewScreen
                workspaceId={activeWorkspace.id}
                workspaceName={activeWorkspace.name}
                agentCount={activeWorkspace.agents.length}
                deployedAgentCount={activeWorkspace.agents.filter((agent) => agent.status === "published").length}
                onOpenBuilder={openAgentLibrary}
                onOpenCalls={() => setSection("calls")}
              />
            )}
            {section === "builder" && activeWorkspace && !activeAgent && (
              <AgentsScreen
                agents={agents}
                onOpen={setActiveAgentId}
                onCreate={createAgent}
                onUpdate={updateAgentDetails}
                onDuplicate={duplicateAgent}
                onDelete={deleteAgent}
              />
            )}
            {section === "builder" && activeWorkspace && activeAgent && (
              <FlowBuilder
                key={activeAgent.id}
                flow={activeAgent}
                tools={activeWorkspace.tools}
                functions={activeWorkspace.functions}
                dataAssets={activeWorkspace.dataAssets}
                stateSchemas={activeWorkspace.stateSchemas}
                dark={dark}
                onSave={updateActiveAgent}
                onBack={openAgentLibrary}
                onPublish={() => {
                  setPublishError(null);
                  setPublishOpen(true);
                }}
              />
            )}
            {section === "contacts" && activeWorkspace && (
              <ContactsScreen contacts={activeWorkspace.contacts} onSave={saveContact} onDelete={deleteContact} />
            )}
            {section === "live" && activeWorkspace && (
              <CallLiveScreen
                workspaceId={activeWorkspace.id}
                contacts={activeWorkspace.contacts}
                onLiveCountChange={setRuntimeLiveCallCount}
              />
            )}
            {section === "calls" && activeWorkspace && (
              <CallsScreen
                workspaceId={activeWorkspace.id}
                contacts={activeWorkspace.contacts}
                onCountChange={setRuntimeCallCount}
              />
            )}
            {section === "reports" && activeWorkspace && (
              <ReportsScreen
                workspaceId={activeWorkspace.id}
                contacts={activeWorkspace.contacts}
                reportEvent={latestReportEvent}
                onCountChange={setRuntimeReportCount}
              />
            )}
            {section === "tools" && activeWorkspace && (
              <ToolsScreen
                tools={activeWorkspace.tools}
                dataAssets={activeWorkspace.dataAssets}
                stateSchemas={activeWorkspace.stateSchemas}
                onSave={saveTool}
                onDelete={deleteTool}
              />
            )}
            {section === "functions" && activeWorkspace && (
              <FunctionsScreen
                functions={activeWorkspace.functions}
                dataAssets={activeWorkspace.dataAssets}
                stateSchemas={activeWorkspace.stateSchemas}
                onSave={saveFunction}
                onDelete={deleteFunction}
              />
            )}
            {section === "state" && activeWorkspace && (
              <StateScreen
                schemas={activeWorkspace.stateSchemas}
                agents={activeWorkspace.agents}
                dataAssets={activeWorkspace.dataAssets}
                onSave={saveStateSchema}
                onDelete={deleteStateSchema}
              />
            )}
            {section === "data" && activeWorkspace && (
              <DataScreen
                assets={activeWorkspace.dataAssets}
                stateSchemas={activeWorkspace.stateSchemas}
                onCreate={createDataAsset}
                onDelete={deleteDataAsset}
              />
            )}
            {section === "deployments" && activeWorkspace && (
              <DeploymentsScreen
                agents={activeWorkspace.agents}
                contacts={activeWorkspace.contacts}
                workspaceId={activeWorkspace.id}
                settings={activeWorkspace.settings}
                onStartCall={async (request) => {
                  const result = await startOutboundCall(activeWorkspace.settings, request);
                  await refreshCallCounts(activeWorkspace.id);
                  setToast(`Outbound call ${result.status}${result.call_sid ? ` · ${result.call_sid}` : ""}`);
                  setSection("live");
                }}
              />
            )}
            {section === "settings" && activeWorkspace && (
              <SettingsScreen
                settings={activeWorkspace.settings}
                onChange={updateWorkspaceSettings}
                onSave={async () => {
                  await saveWorkspaceSettings(activeWorkspace.settings, activeWorkspace.id);
                  setToast("Settings saved.");
                }}
              />
            )}
            {section === "help" && <HelpScreen />}
          </>
        )}
      </div>

      {activeAgent && (
        <Dialog
          open={publishOpen}
          onOpenChange={setPublishOpen}
          title={
            activeAgent.status === "published" ? `Update ${activeAgent.name} deployment` : `Deploy ${activeAgent.name}`
          }
          description="Changes apply to calls started after this deployment."
          footer={
            <>
              <Button variant="secondary" onClick={() => setPublishOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={publishing}
                onClick={publish}
                disabled={issues.some((issue) => issue.level === "error")}
              >
                <Rocket className="h-4 w-4" /> {activeAgent.status === "published" ? "Update Deployment" : "Deploy"}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
                <p className="text-[9px] text-[var(--text-muted)]">Nodes</p>
                <p className="mt-1 text-lg font-extrabold text-[var(--text)]">{activeAgent.nodes.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
                <p className="text-[9px] text-[var(--text-muted)]">Edges</p>
                <p className="mt-1 text-lg font-extrabold text-[var(--text)]">{activeAgent.edges.length}</p>
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)] p-3.5">
                <p className="text-[9px] text-[var(--text-muted)]">Tools</p>
                <p className="mt-1 text-lg font-extrabold text-[var(--text)]">
                  {new Set(activeAgent.nodes.flatMap((node) => node.data.toolIds)).size}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-[var(--green-border)] bg-[var(--green-soft)] p-4">
              <div className="flex items-center gap-2 text-xs font-bold text-[var(--green)]">
                <ShieldCheck className="h-4 w-4" /> Validation passed
              </div>
              <p className="mt-1.5 text-[10px] leading-5 text-[var(--text-secondary)]">
                Start session, Edge conditions, Tool connections, and End policies are valid.
              </p>
            </div>
            {publishError && (
              <div
                className="rounded-xl border border-[var(--red-border)] bg-[var(--red-soft)] px-4 py-3 text-xs font-semibold text-[var(--red)]"
                role="alert"
              >
                {publishError}
              </div>
            )}
          </div>
        </Dialog>
      )}

      {toast && (
        <div
          className="fixed bottom-5 right-5 z-[150] flex min-w-80 items-center gap-3 rounded-xl border border-[var(--green-border)] bg-[var(--surface)] px-4 py-3 shadow-2xl"
          role="status"
          aria-live="polite"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--green-soft)] text-[var(--green)]">
            <Check className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-bold text-[var(--text)]">Done</p>
            <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">{toast}</p>
          </div>
        </div>
      )}
      {workspaceSaveError && (
        <div
          className="fixed bottom-5 left-1/2 z-[160] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-[var(--red-border)] bg-[var(--surface)] px-4 py-3 shadow-2xl"
          role="alert"
        >
          <AlertCircle className="h-4 w-4 shrink-0 text-[var(--red)]" />
          <p className="text-[10px] font-semibold text-[var(--text)]">{workspaceSaveError}</p>
        </div>
      )}
    </div>
  );
}
