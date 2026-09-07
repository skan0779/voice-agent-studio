import { describe, expect, it } from "vitest";
import { fixtureFunctions } from "../test/fixtures";
import {
  composePythonFunction,
  createServiceFunction,
  duplicateServiceFunction,
  functionActionComplete,
  inferPythonOutputFields,
  migrateFunctions,
  pythonFunctionBody,
} from "./functions";

describe("service functions", () => {
  it("creates a function with a generated key", () => {
    expect(
      createServiceFunction("Apply Selection", "Updates runtime state.", {
        id: "fn",
        now: "now",
      }),
    ).toMatchObject({
      id: "fn",
      key: "apply_selection",
      inputs: [],
      actions: [],
    });
  });

  it("migrates legacy function values safely", () => {
    const [result] = migrateFunctions([
      {
        name: "Update Session",
        inputs: [{ name: "status", type: "string", required: true }],
        actions: [
          {
            type: "update_state",
            target: "@example_state.session.status",
            value: "active",
          },
        ],
      },
    ]);

    expect(result.key).toBe("update_session");
    expect(result.inputs[0]).toMatchObject({
      name: "status",
      type: "string",
      required: true,
    });
    expect(result.actions[0].type).toBe("state");
    expect(result.actions[0].updates).toEqual([
      expect.objectContaining({
        target: "@example_state.session.status",
        method: "replace",
        value: "active",
      }),
    ]);
    expect(functionActionComplete(result.actions[0])).toBe(true);
  });

  it("duplicates with a unique name and key", () => {
    const source = {
      ...createServiceFunction("Apply Selection", "", {
        id: "fn",
        now: "now",
      }),
      templateVersion: 2,
    };
    const copy = duplicateServiceFunction(source, [source]);

    expect(copy.name).toBe("Apply Selection Copy");
    expect(copy.key).toBe("apply_selection_copy");
    expect(copy.templateVersion).toBeUndefined();
  });

  it("migrates legacy Handler Actions into editable Python Code Actions", () => {
    const [migrated] = migrateFunctions([
      {
        name: "Transform Input",
        actions: [
          {
            type: "evaluate_assessment",
            source: "@input.payload",
            resultKey: "evaluation",
          },
          {
            type: "append_state",
            target: "@example_state.session.events",
            value: "@evaluation.items",
          },
        ],
      },
    ]);

    expect(migrated.actions.map((action) => action.type)).toEqual(["code", "state"]);
    expect(migrated.actions[0]).toMatchObject({
      outputName: "Evaluation",
      resultKey: "evaluation",
    });
    expect(migrated.actions[1].updates[0]).toMatchObject({
      method: "append",
      value: "@output.evaluation.items",
    });
    expect(functionActionComplete(migrated.actions[0])).toBe(false);
    expect(functionActionComplete(migrated.actions[1])).toBe(true);
  });

  it("discards legacy Return Actions now that runtime values use State", () => {
    const [migrated] = migrateFunctions([
      {
        name: "Return Customer",
        actions: [
          { type: "set_variable", value: "active", resultKey: "status" },
          { type: "return", value: "@status" },
        ],
      },
    ]);

    expect(migrated.actions).toEqual([]);
    expect(migrated).not.toHaveProperty("output");
  });

  it("migrates the legacy singular input namespace", () => {
    const [migrated] = migrateFunctions([
      {
        name: "Update Status",
        actions: [
          {
            type: "state",
            target: "@example_state.session.status",
            value: "@input.status",
          },
        ],
      },
    ]);

    expect(migrated.actions[0].updates[0].value).toBe("@inputs.status");
  });

  it("provides a complete generic Function fixture", () => {
    expect(fixtureFunctions).toHaveLength(1);
    expect(fixtureFunctions[0].key).toBe("apply_choice");
    expect(fixtureFunctions[0].actions.every(functionActionComplete)).toBe(true);
  });

  it("stores only the editable body and generates the Python wrapper", () => {
    const legacyCode = `def run(inputs):\n    if inputs["enabled"]:\n        return {"ok": True}\n`;
    const body = pythonFunctionBody(legacyCode);

    expect(body).toBe(`if inputs["enabled"]:\n    return {"ok": True}`);
    expect(composePythonFunction(body)).toBe(legacyCode);
  });

  it("infers returned dictionary fields from every code path", () => {
    const code = `if inputs["enabled"]:\n    return {"status": "ready", "count": 1}\nreturn {\n    "status": "skipped",\n    "items": [],\n}`;

    expect(inferPythonOutputFields(code)).toEqual(
      expect.arrayContaining([
        { path: "status", type: "string" },
        { path: "count", type: "integer" },
        { path: "items", type: "array" },
      ]),
    );
  });
});
