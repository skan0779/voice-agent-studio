import { describe, expect, it } from "vitest";
import {
  fixtureFlow,
  fixtureFunctions,
  fixturePlatformSettings,
  fixtureStateSchemas,
  fixtureTools,
} from "../test/fixtures";
import { createWorkspace, duplicateWorkspace, formatContactPhoneNumber, migrateWorkspaces } from "./workspaces";

describe("workspaces", () => {
  it("formats Korean mobile phone numbers without changing international numbers", () => {
    expect(formatContactPhoneNumber("01098880779")).toBe("010-9888-0779");
    expect(formatContactPhoneNumber("010-9888-0779")).toBe("010-9888-0779");
    expect(formatContactPhoneNumber("+821098880779")).toBe("+821098880779");
  });

  it("creates an empty workspace without bundled content", () => {
    const workspace = createWorkspace("Example Workspace", "A generic workspace", fixturePlatformSettings, {
      id: "workspace-example",
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(workspace.name).toBe("Example Workspace");
    expect(workspace.agents).toEqual([]);
    expect(workspace.tools).toEqual([]);
    expect(workspace.functions).toEqual([]);
    expect(workspace.stateSchemas).toEqual([]);
    expect(workspace.dataAssets).toEqual([]);
    expect(workspace.contacts).toEqual([]);
  });

  it("does not inject content while migrating an empty workspace", () => {
    const [workspace] = migrateWorkspaces(
      [
        {
          id: "workspace-example",
          name: "Example Workspace",
          settings: fixturePlatformSettings,
        },
      ],
      fixtureFlow,
      fixturePlatformSettings,
    );

    expect(workspace.agents).toEqual([]);
    expect(workspace.tools).toEqual([]);
    expect(workspace.functions).toEqual([]);
    expect(workspace.stateSchemas).toEqual([]);
    expect(workspace.dataAssets).toEqual([]);
    expect(workspace.calls).toEqual([]);
  });

  it("migrates contacts", () => {
    const [workspace] = migrateWorkspaces(
      [
        {
          id: "workspace-example",
          name: "Example Workspace",
          contacts: [
            {
              id: "contact-1",
              name: "Example User",
              phoneNumber: "01012345678",
              gender: "female",
              details: "Preferred contact",
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
          settings: fixturePlatformSettings,
        },
      ],
      fixtureFlow,
      fixturePlatformSettings,
    );

    expect(workspace.contacts).toEqual([
      expect.objectContaining({
        id: "contact-1",
        name: "Example User",
        phoneNumber: "010-1234-5678",
        gender: "female",
      }),
    ]);
  });

  it("migrates existing workspace resources without replacing them", () => {
    const [workspace] = migrateWorkspaces(
      [
        {
          id: "workspace-example",
          name: "Example Workspace",
          agents: [fixtureFlow],
          tools: fixtureTools,
          functions: fixtureFunctions,
          stateSchemas: fixtureStateSchemas,
          installedToolTemplateIds: ["legacy-tool-template"],
          installedFunctionTemplateIds: ["legacy-function-template"],
          settings: fixturePlatformSettings,
        },
      ],
      fixtureFlow,
      fixturePlatformSettings,
    );

    expect(workspace.agents).toHaveLength(1);
    expect(workspace.tools).toHaveLength(1);
    expect(workspace.functions).toHaveLength(1);
    expect(workspace.stateSchemas).toHaveLength(1);
    expect(workspace.installedToolTemplateIds).toEqual(["legacy-tool-template"]);
    expect(workspace.installedFunctionTemplateIds).toEqual(["legacy-function-template"]);
    expect(workspace.settings.connections.telephonyIntegration).toBe("media_streams");
  });

  it("migrates legacy categorized data into file-backed data", () => {
    const [workspace] = migrateWorkspaces(
      [
        {
          id: "workspace-example",
          name: "Example Workspace",
          dataAssets: [
            {
              id: "catalog",
              name: "Catalog",
              category: "knowledge",
              format: "JSON",
              updatedAt: "2026-01-01T00:00:00.000Z",
            },
          ],
          settings: fixturePlatformSettings,
        },
      ],
      fixtureFlow,
      fixturePlatformSettings,
    );

    expect(workspace.dataAssets[0]).toMatchObject({
      id: "catalog",
      sourceType: "file",
      format: "JSON",
      fileName: "catalog.json",
      content: "",
    });
    expect(workspace.dataAssets[0].description).toContain("knowledge");
  });

  it("removes obsolete Function input mappings without changing valid mappings", () => {
    const agent = structuredClone(fixtureFlow);
    const collector = agent.nodes.find((node) => node.data.kind === "node")!;
    collector.data.toolFunctionBindings![0].inputMappings.unshift({
      inputName: "removed_input",
      value: "@tool.arguments.removed_input",
    });

    const [workspace] = migrateWorkspaces(
      [
        {
          id: "workspace-example",
          name: "Example Workspace",
          agents: [agent],
          tools: fixtureTools,
          functions: fixtureFunctions,
          stateSchemas: fixtureStateSchemas,
          settings: fixturePlatformSettings,
        },
      ],
      fixtureFlow,
      fixturePlatformSettings,
    );

    expect(
      workspace.agents[0].nodes.find((node) => node.data.kind === "node")?.data.toolFunctionBindings?.[0].inputMappings,
    ).toEqual([{ inputName: "choice", value: "@tool.arguments.choice" }]);
  });

  it("clears provider secrets when duplicating a workspace", () => {
    const workspace = createWorkspace("Example Workspace", "", {
      ...fixturePlatformSettings,
      environmentVariables: {
        ...fixturePlatformSettings.environmentVariables,
        twilioAuthToken: "stored-token",
        openaiApiKey: "stored-key",
      },
    });
    const duplicate = duplicateWorkspace(workspace, fixturePlatformSettings);

    expect(duplicate.name).toBe("Example Workspace Copy");
    expect(duplicate.settings.environmentVariables.twilioAuthToken).toBe("");
    expect(duplicate.settings.environmentVariables.openaiApiKey).toBe("");
  });
});
