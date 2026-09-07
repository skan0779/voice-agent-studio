import { describe, expect, it } from "vitest";
import { fixtureStateSchemas } from "../test/fixtures";
import {
  listStateReferenceSuggestions,
  parseStateReferenceExpression,
  collectStatePathRenames,
  renameStateBindingKey,
  renameStateBindingPaths,
  resolveStateReference,
  stateReferenceExists,
} from "./stateReferences";

describe("State references", () => {
  it("lists custom and system paths under the runtime State alias", () => {
    const suggestions = listStateReferenceSuggestions(fixtureStateSchemas);
    const expressions = suggestions.map((item) => item.expression);

    expect(expressions).toContain("@state.system.call_id");
    expect(expressions).toContain("@state.session.choice");
    expect(expressions).not.toContain("@example_state.session.choice");
    expect(suggestions[0]).toMatchObject({
      dataName: "Example State",
      dataDescription: fixtureStateSchemas[0].description,
    });
  });

  it("parses only fields defined by the selected State Schema", () => {
    expect(parseStateReferenceExpression("@example_state.session.choice", fixtureStateSchemas)).toEqual({
      kind: "state",
      schemaKey: "example_state",
      path: "session.choice",
    });
    expect(parseStateReferenceExpression("@example_state.session.missing", fixtureStateSchemas)).toBeNull();
    expect(parseStateReferenceExpression("@state.session.choice", fixtureStateSchemas)).toEqual({
      kind: "state",
      path: "session.choice",
    });
  });

  it("resolves a runtime value without reading another call instance", () => {
    const reference = { kind: "state" as const, path: "session.attempts" };
    const firstCall = { session: { attempts: 0 } };
    const secondCall = { session: { attempts: 4 } };

    expect(resolveStateReference(reference, firstCall)).toEqual([0]);
    expect(resolveStateReference(reference, secondCall)).toEqual([4]);
    expect(stateReferenceExists(reference, fixtureStateSchemas)).toBe(true);
  });

  it("keeps structured metadata current and converts keyed bindings to the runtime alias", () => {
    const value = {
      instructions: "Ask about @example_state.session.choice.",
      parameters: [{ enumValues: [{ kind: "state", schemaKey: "example_state", path: "session.attempts" }] }],
    };

    expect(renameStateBindingKey(value, "example_state", "workflow_state")).toEqual({
      instructions: "Ask about @state.session.choice.",
      parameters: [{ enumValues: [{ kind: "state", schemaKey: "workflow_state", path: "session.attempts" }] }],
    });
  });

  it("renames Object and Field paths in inline and structured State bindings", () => {
    const previous = {
      ...fixtureStateSchemas[0],
      groups: [
        {
          id: "group-session",
          displayName: "Session",
          key: "session",
          fields: [
            {
              id: "field-status",
              displayName: "Status",
              key: "status",
              description: "",
              type: "string" as const,
              defaultValue: "idle",
              updateMethod: "replace" as const,
              readOnly: false,
            },
          ],
        },
      ],
    };
    const next = {
      ...previous,
      groups: [
        {
          ...previous.groups[0],
          displayName: "Assessment",
          key: "assessment",
          fields: [{ ...previous.groups[0].fields[0], displayName: "Progress", key: "progress" }],
        },
      ],
    };
    const renames = collectStatePathRenames(previous, next);
    const value = {
      instruction: "Check @state.session.status before continuing.",
      reference: { kind: "state", path: "session.status" },
    };

    expect(renameStateBindingPaths(value, renames)).toEqual({
      instruction: "Check @state.assessment.progress before continuing.",
      reference: { kind: "state", path: "assessment.progress" },
    });
  });
});
