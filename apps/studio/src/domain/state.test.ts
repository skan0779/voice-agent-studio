import { describe, expect, it } from "vitest";
import { duplicateStateSchema, migrateStateSchemas } from "./state";
import { fixtureStateSchemas } from "../test/fixtures";

describe("State Schema keys", () => {
  it("adds stable, unique keys when migrating legacy State Schemas", () => {
    const schemas = migrateStateSchemas([
      { id: "first", name: "On Call State", groups: [] },
      { id: "second", name: "On Call State", groups: [] },
    ]);

    expect(schemas.map((schema) => schema.key)).toEqual(["on_call_state", "on_call_state_2"]);
  });

  it("creates a unique key when duplicating a State Schema", () => {
    const [schema] = migrateStateSchemas([{ id: "first", name: "On Call State", groups: [] }]);
    const firstCopy = duplicateStateSchema(schema, [schema]);
    const secondCopy = duplicateStateSchema(schema, [schema, firstCopy]);

    expect(firstCopy).toMatchObject({ name: "On Call State Copy", key: "on_call_state_copy" });
    expect(secondCopy).toMatchObject({ name: "On Call State Copy 2", key: "on_call_state_copy_2" });
  });

  it("preserves generic State groups and fields", () => {
    const [schema] = migrateStateSchemas(fixtureStateSchemas);
    expect(schema.key).toBe("example_state");
    expect(schema.groups[0].key).toBe("session");
    expect(schema.groups[0].fields.map((field) => field.key)).toEqual(["choice", "attempts"]);
  });
});
