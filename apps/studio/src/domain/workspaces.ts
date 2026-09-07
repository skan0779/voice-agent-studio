import type { CallRecord, FlowDocument, PlatformSettings, ToolDefinition } from "./flow";
import { migrateAgents } from "./agents";
import { migrateFunctions, type ServiceFunction } from "./functions";
import { migratePlatformSettings } from "./settings";
import { migrateStateSchemas, type StateSchema } from "./state";
import { normalizeStateBindingAliases } from "./stateReferences";
import { migrateTools } from "./tools";

export interface DataAsset {
  id: string;
  name: string;
  description: string;
  sourceType: "file" | "text";
  format: "JSON" | "CSV" | "PDF" | "Markdown" | "Text";
  content: string;
  fileName?: string;
  fileSize?: number;
  contentVersion?: number;
  updatedAt: string;
}

export type ContactGender = "female" | "male" | "";

export interface Contact {
  id: string;
  name: string;
  phoneNumber: string;
  age: number | null;
  gender: ContactGender;
  email: string;
  photoDataUrl: string;
  details: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceDocument {
  id: string;
  name: string;
  description: string;
  agents: FlowDocument[];
  tools: ToolDefinition[];
  installedToolTemplateIds: string[];
  functions: ServiceFunction[];
  installedFunctionTemplateIds: string[];
  stateSchemas: StateSchema[];
  dataAssets: DataAsset[];
  contacts: Contact[];
  calls: CallRecord[];
  settings: PlatformSettings;
  updatedAt: string;
}

export function formatContactPhoneNumber(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith("+")) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits.startsWith("010")) return trimmed;
  const mobile = digits.slice(0, 11);
  if (mobile.length <= 3) return mobile;
  if (mobile.length <= 7) return `${mobile.slice(0, 3)}-${mobile.slice(3)}`;
  return `${mobile.slice(0, 3)}-${mobile.slice(3, 7)}-${mobile.slice(7)}`;
}

function migrateContacts(raw: unknown): Contact[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const createdAt = typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString();
      return {
        id: typeof item.id === "string" ? item.id : `contact-${index + 1}`,
        name: typeof item.name === "string" ? item.name : `Contact ${index + 1}`,
        phoneNumber: typeof item.phoneNumber === "string" ? formatContactPhoneNumber(item.phoneNumber) : "",
        age: typeof item.age === "number" && Number.isFinite(item.age) ? item.age : null,
        gender: ["female", "male"].includes(String(item.gender)) ? (item.gender as ContactGender) : "",
        email: typeof item.email === "string" ? item.email : "",
        photoDataUrl: typeof item.photoDataUrl === "string" ? item.photoDataUrl : "",
        details: typeof item.details === "string" ? item.details : "",
        createdAt,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : createdAt,
      };
    });
}

function migrateDataAssets(raw: unknown): DataAsset[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const id = typeof item.id === "string" ? item.id : `data-${index + 1}`;
      const format = ["JSON", "CSV", "PDF", "Markdown", "Text"].includes(item.format)
        ? (item.format as DataAsset["format"])
        : "Text";
      const legacyDescription =
        item.category === "assessment"
          ? "Structured assessment data used by voice agents."
          : item.category === "policy"
            ? "Runtime policy data used by voice agents."
            : "Reusable knowledge source for voice agents.";
      const sourceType = item.sourceType === "text" ? "text" : "file";
      return {
        id,
        name: typeof item.name === "string" ? item.name : `Data ${index + 1}`,
        description: typeof item.description === "string" ? item.description : legacyDescription,
        sourceType,
        format,
        content: typeof item.content === "string" ? item.content : "",
        fileName:
          typeof item.fileName === "string"
            ? item.fileName
            : sourceType === "file"
              ? `${id}.${format === "Markdown" ? "md" : format.toLowerCase()}`
              : undefined,
        fileSize: typeof item.fileSize === "number" ? item.fileSize : undefined,
        contentVersion: typeof item.contentVersion === "number" ? item.contentVersion : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      };
    });
}

function removeUnavailableFunctionInputMappings(agents: FlowDocument[], functions: ServiceFunction[]) {
  const functionInputs = new Map(
    functions.map((serviceFunction) => [
      serviceFunction.id,
      new Set(serviceFunction.inputs.map((input) => input.name)),
    ]),
  );
  return agents.map((agent) => ({
    ...agent,
    nodes: agent.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        toolFunctionBindings: (node.data.toolFunctionBindings ?? []).map((binding) => {
          const availableInputs = functionInputs.get(binding.functionId);
          if (!availableInputs) return binding;
          return {
            ...binding,
            inputMappings: binding.inputMappings.filter((mapping) => availableInputs.has(mapping.inputName)),
          };
        }),
      },
    })),
  }));
}

function stringList(raw: unknown) {
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === "string") : [];
}

export function createWorkspace(
  name: string,
  description: string,
  defaultSettings: PlatformSettings,
  options: { id?: string; now?: string } = {},
): WorkspaceDocument {
  return {
    id: options.id ?? `workspace-${crypto.randomUUID()}`,
    name: name.trim(),
    description: description.trim(),
    agents: [],
    tools: [],
    installedToolTemplateIds: [],
    functions: [],
    installedFunctionTemplateIds: [],
    stateSchemas: [],
    dataAssets: [],
    contacts: [],
    calls: [],
    settings: structuredClone(defaultSettings),
    updatedAt: options.now ?? new Date().toISOString(),
  };
}

export function createDefaultWorkspace(defaultSettings: PlatformSettings): WorkspaceDocument {
  return createWorkspace("Default", "default workspace", defaultSettings, {
    id: "workspace-default",
  });
}

export function migrateWorkspaces(
  raw: unknown,
  fallbackFlow: FlowDocument,
  fallbackSettings: PlatformSettings,
): WorkspaceDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is Record<string, any> => Boolean(item) && typeof item === "object")
    .map((item, index) => {
      const dataAssets = migrateDataAssets(item.dataAssets);
      const stateSchemas = migrateStateSchemas(
        item.stateSchemas,
        dataAssets.map((asset) => asset.name),
      );
      const functions = normalizeStateBindingAliases(migrateFunctions(item.functions), stateSchemas);
      const agents = normalizeStateBindingAliases(migrateAgents(item.agents, fallbackFlow), stateSchemas);

      return {
        id: typeof item.id === "string" ? item.id : `workspace-${index + 1}`,
        name: typeof item.name === "string" ? item.name : `Workspace ${index + 1}`,
        description: typeof item.description === "string" ? item.description : "",
        agents: removeUnavailableFunctionInputMappings(agents, functions),
        tools: normalizeStateBindingAliases(migrateTools(item.tools), stateSchemas),
        installedToolTemplateIds: stringList(item.installedToolTemplateIds),
        functions,
        installedFunctionTemplateIds: stringList(item.installedFunctionTemplateIds),
        stateSchemas,
        dataAssets,
        contacts: migrateContacts(item.contacts),
        calls: Array.isArray(item.calls) ? item.calls : [],
        settings: migratePlatformSettings(item.settings, fallbackSettings),
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date().toISOString(),
      };
    });
}

export function duplicateWorkspace(workspace: WorkspaceDocument, defaultSettings: PlatformSettings): WorkspaceDocument {
  const copy = structuredClone(workspace);
  return {
    ...copy,
    id: `workspace-${crypto.randomUUID()}`,
    name: `${workspace.name} Copy`,
    contacts: [],
    calls: [],
    settings: {
      ...copy.settings,
      environmentVariables: {
        ...copy.settings.environmentVariables,
        twilioAuthToken: defaultSettings.environmentVariables.twilioAuthToken,
        openaiApiKey: defaultSettings.environmentVariables.openaiApiKey,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}
