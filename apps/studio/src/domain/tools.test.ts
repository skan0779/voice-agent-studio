import { describe, expect, it } from "vitest";
import { fixtureTools } from "../test/fixtures";
import { migrateTools, toRealtimeTool } from "./tools";
import type { DataAsset } from "./workspaces";

describe("Realtime tools", () => {
  it("migrates legacy fields into Tool parameters", () => {
    const [tool] = migrateTools([
      {
        id: "choice",
        name: "record_choice",
        displayName: "Record Choice",
        description: "Record a choice.",
        fields: [
          {
            id: "value",
            label: "Selected value",
            type: "enum",
            required: true,
            options: ["one", "two"],
          },
        ],
      },
    ]);

    expect(tool.parameters[0]).toMatchObject({
      name: "value",
      description: "Selected value",
      type: "string",
      enumValues: ["one", "two"],
    });
  });

  it("serializes the builder model to the Realtime function schema", () => {
    expect(toRealtimeTool(fixtureTools[0])).toEqual({
      type: "function",
      name: "collect_choice",
      description: "Collect a structured choice from the caller.",
      parameters: {
        type: "object",
        properties: {
          choice: {
            type: "string",
            description: "The selected choice.",
            enum: ["continue", "finish"],
          },
        },
        required: ["choice"],
        additionalProperties: false,
      },
    });
  });

  it("serializes an array of allowed string values", () => {
    const [tool] = migrateTools([
      {
        id: "tags",
        name: "record_tags",
        displayName: "Record Tags",
        description: "Record tags.",
        parameters: [
          {
            id: "tags",
            name: "tags",
            description: "Selected tags",
            type: "array",
            itemType: "string",
            required: true,
            enumValues: ["alpha", "beta"],
            uniqueItems: true,
          },
        ],
      },
    ]);

    expect(toRealtimeTool(tool).parameters.properties.tags).toEqual({
      type: "array",
      description: "Selected tags",
      items: { type: "string", enum: ["alpha", "beta"] },
      uniqueItems: true,
    });
  });

  it("preserves numeric enum values as numbers", () => {
    const [tool] = migrateTools([
      {
        id: "rating",
        name: "record_rating",
        displayName: "Record Rating",
        description: "Record a rating.",
        parameters: [
          {
            id: "rating",
            name: "rating",
            description: "Numeric rating",
            type: "integer",
            required: true,
            enumValues: [1, 2, 3],
          },
        ],
      },
    ]);

    expect(toRealtimeTool(tool).parameters.properties.rating).toEqual({
      type: "integer",
      description: "Numeric rating",
      enum: [1, 2, 3],
    });
  });

  it("resolves @Data references before producing a Realtime schema", () => {
    const asset: DataAsset = {
      id: "options",
      name: "Options",
      description: "",
      sourceType: "text",
      format: "JSON",
      content: JSON.stringify({ allowed: [1, 2, 3] }),
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const [tool] = migrateTools([
      {
        id: "rating",
        name: "record_rating",
        displayName: "Record Rating",
        description: "Record a rating.",
        parameters: [
          {
            id: "rating",
            name: "rating",
            description: "Numeric rating",
            type: "integer",
            required: true,
            enumValues: [{ kind: "data", dataId: "options", path: "allowed[]" }],
          },
        ],
      },
    ]);

    expect(toRealtimeTool(tool, [asset]).parameters.properties.rating).toEqual({
      type: "integer",
      description: "Numeric rating",
      enum: [1, 2, 3],
    });
  });

  it("resolves @state references from the current call", () => {
    const [tool] = migrateTools([
      {
        id: "choice",
        name: "record_choice",
        displayName: "Record Choice",
        description: "Record a choice.",
        parameters: [
          {
            id: "choice",
            name: "choice",
            description: "Mapped choice",
            type: "string",
            required: true,
            enumValues: [{ kind: "state", path: "session.allowed_choices" }],
          },
        ],
      },
    ]);

    expect(
      toRealtimeTool(tool, [], {
        session: { allowed_choices: ["continue", "finish"] },
      }).parameters.properties.choice,
    ).toEqual({
      type: "string",
      description: "Mapped choice",
      enum: ["continue", "finish"],
    });
  });

  it("resolves an indirect Data enum from the current State", () => {
    const asset: DataAsset = {
      id: "catalog",
      name: "Catalog",
      description: "",
      sourceType: "text",
      format: "JSON",
      content: JSON.stringify({
        groups: [{ key: "primary" }],
        options: { primary: [{ id: "alpha" }, { id: "beta" }] },
      }),
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const [tool] = migrateTools([
      {
        id: "choice",
        name: "record_choice",
        displayName: "Record Choice",
        description: "Record a choice.",
        parameters: [
          {
            id: "choice",
            name: "choice",
            description: "Mapped choice",
            type: "string",
            required: false,
            enumValues: [
              {
                kind: "data",
                dataId: "catalog",
                path: "options[@Catalog.groups[@state.session.group_index].key][].id",
              },
            ],
          },
        ],
      },
    ]);

    expect(toRealtimeTool(tool, [asset], { session: { group_index: 0 } }).parameters.properties.choice).toEqual({
      type: "string",
      description: "Mapped choice",
      enum: ["alpha", "beta"],
    });
  });

  it("serializes a Tool without arguments", () => {
    const [tool] = migrateTools([
      {
        id: "finish",
        name: "finish_session",
        displayName: "Finish Session",
        description: "Finish the current session.",
        parameters: [],
      },
    ]);

    expect(toRealtimeTool(tool).parameters).toEqual({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });
});
