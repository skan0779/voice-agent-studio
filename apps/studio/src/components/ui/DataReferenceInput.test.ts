import { describe, expect, it } from "vitest";
import {
  buildDataReferenceMenuOptions,
  findReferenceQuery,
  insertReference,
  splitReferenceText,
} from "./DataReferenceInput";
import type { DataReferenceSuggestion } from "../../domain/dataReferences";

describe("DataReferenceInput token editing", () => {
  it("opens a query as soon as @ is entered", () => {
    expect(findReferenceQuery("Use @", 5)).toEqual({ start: 4, end: 5, query: "" });
  });

  it("filters from the active reference token", () => {
    expect(findReferenceQuery("Use @PHQ items", 8)).toEqual({ start: 4, end: 8, query: "PHQ" });
  });

  it("inserts a reference without replacing surrounding text", () => {
    const query = findReferenceQuery("Use @ph here", 7)!;
    expect(insertReference("Use @ph here", query, "@PHQ-2.items[].prompt")).toEqual({
      value: "Use @PHQ-2.items[].prompt here",
      caret: 25,
    });
  });

  it("splits completed references into display badges", () => {
    const suggestion: DataReferenceSuggestion = {
      expression: "@PHQ-2.items[].prompt",
      reference: { kind: "data", dataId: "phq-2", path: "items[].prompt" },
      values: ["Question"],
    };
    expect(splitReferenceText("Ask @PHQ-2.items[].prompt naturally.", [suggestion])).toEqual([
      { kind: "text", value: "Ask " },
      { kind: "reference", value: suggestion.expression, suggestion },
      { kind: "text", value: " naturally." },
    ]);
  });

  it("recognizes a reference immediately when the path is completed", () => {
    const suggestion: DataReferenceSuggestion = {
      expression: "@test.value",
      reference: { kind: "data", dataId: "test", path: "value" },
      values: ["ready"],
    };
    expect(splitReferenceText("@test.value", [suggestion])).toEqual([
      { kind: "reference", value: "@test.value", suggestion },
    ]);
  });

  it("uses the runtime State alias while displaying the schema name", () => {
    const suggestion: DataReferenceSuggestion = {
      expression: "@state.screening.current_item_id",
      reference: { kind: "state", schemaKey: "on_call_state", path: "screening.current_item_id" },
      values: ["phq2_1"],
      dataName: "On Call State",
      dataDescription: "Tracks the current call.",
      sourceKind: "state",
    };

    expect(splitReferenceText("Ask @state.screening.current_item_id now.", [suggestion])).toEqual([
      { kind: "text", value: "Ask " },
      { kind: "reference", value: suggestion.expression, suggestion },
      { kind: "text", value: " now." },
    ]);
    expect(buildDataReferenceMenuOptions("", [suggestion])).toEqual([
      expect.objectContaining({
        kind: "data",
        dataName: "On Call State",
        bindingName: "state",
        description: "Tracks the current call.",
        sourceKind: "state",
      }),
    ]);
    expect(buildDataReferenceMenuOptions("state.", [suggestion])).toContainEqual(
      expect.objectContaining({ kind: "path", segment: "screening", sourceKind: "state", isLeaf: false }),
    );
  });

  it("offers Function Code results under the local Output namespace", () => {
    const suggestion: DataReferenceSuggestion = {
      expression: "@output.evaluation",
      reference: { kind: "output", outputKey: "evaluation", path: "evaluation" },
      values: [],
      dataName: "Output",
      dataDescription: "Results from previous Code Actions.",
      sourceKind: "output",
    };
    const answersSuggestion: DataReferenceSuggestion = {
      ...suggestion,
      expression: "@output.evaluation.answers",
      reference: { kind: "output", outputKey: "evaluation", path: "evaluation.answers" },
    };
    const suggestions = [suggestion, answersSuggestion];

    expect(buildDataReferenceMenuOptions("", suggestions)).toEqual([
      expect.objectContaining({
        kind: "data",
        dataName: "Output",
        bindingName: "output",
        sourceKind: "output",
      }),
    ]);
    expect(buildDataReferenceMenuOptions("output.", suggestions)).toEqual([
      expect.objectContaining({
        kind: "path",
        segment: "evaluation",
        sourceKind: "output",
        isLeaf: false,
      }),
    ]);
    expect(buildDataReferenceMenuOptions("output.evaluation.", suggestions)).toEqual([
      expect.objectContaining({ kind: "path", segment: "answers", isLeaf: true }),
    ]);
    expect(splitReferenceText("@output.evaluation.answers", suggestions)).toEqual([
      { kind: "reference", value: "@output.evaluation.answers", suggestion: answersSuggestion },
    ]);
  });

  it("supports a Function input as a dynamic State Object key", () => {
    const suggestions: DataReferenceSuggestion[] = [
      {
        expression: "@state.phq_2.answers",
        reference: { kind: "state", path: "phq_2.answers" },
        values: [],
        dataName: "On Call State",
        sourceKind: "state",
      },
      {
        expression: "@state.gad_2.answers",
        reference: { kind: "state", path: "gad_2.answers" },
        values: [],
        dataName: "On Call State",
        sourceKind: "state",
      },
      {
        expression: "@inputs.assessment_key",
        reference: {
          kind: "input",
          inputKey: "assessment_key",
          path: "assessment_key",
        },
        values: [],
        dataName: "Inputs",
        sourceKind: "input",
      },
    ];

    expect(buildDataReferenceMenuOptions("state.", suggestions)).toContainEqual(
      expect.objectContaining({
        segment: "Use Dynamic Key",
        fullPath: "[@",
        dynamicSelector: "key",
      }),
    );
    expect(buildDataReferenceMenuOptions("state[@inputs.assessment_key].", suggestions)).toContainEqual(
      expect.objectContaining({
        segment: "answers",
        fullPath: "[@inputs.assessment_key].answers",
        isLeaf: true,
      }),
    );
    expect(splitReferenceText("@state[@inputs.assessment_key].answers", suggestions)).toEqual([
      expect.objectContaining({
        kind: "reference",
        value: "@state[@inputs.assessment_key].answers",
      }),
    ]);
  });

  it("offers the selected Tool arguments under one runtime namespace", () => {
    const suggestion: DataReferenceSuggestion = {
      expression: "@tool.arguments.decision",
      reference: { kind: "tool", toolId: "record_consent", path: "decision" },
      values: ["granted", "declined", "unclear"],
      dataName: "Tool Arguments",
      dataDescription: "Arguments received from Record Consent.",
      sourceKind: "tool",
    };

    expect(buildDataReferenceMenuOptions("", [suggestion])).toEqual([
      expect.objectContaining({
        kind: "data",
        dataName: "Tool Arguments",
        bindingName: "tool.arguments",
        sourceKind: "tool",
      }),
    ]);
    expect(buildDataReferenceMenuOptions("tool.arguments.", [suggestion])).toEqual([
      expect.objectContaining({ kind: "path", segment: "decision", sourceKind: "tool", isLeaf: true }),
    ]);
    expect(splitReferenceText("@tool.arguments.decision", [suggestion])).toEqual([
      { kind: "reference", value: suggestion.expression, suggestion },
    ]);
  });

  it("shows data descriptions before browsing one JSON level at a time", () => {
    const suggestions: DataReferenceSuggestion[] = [
      {
        expression: "@AD8.id",
        reference: { kind: "data", dataId: "ad8", path: "id" },
        values: ["ad8"],
        dataName: "AD8",
        dataDescription: "Cognitive screening questionnaire.",
      },
      {
        expression: "@AD8.administration.intro",
        reference: { kind: "data", dataId: "ad8", path: "administration.intro" },
        values: ["Introduction"],
        dataName: "AD8",
        dataDescription: "Cognitive screening questionnaire.",
      },
      {
        expression: "@AD8.administration.response_prompt",
        reference: { kind: "data", dataId: "ad8", path: "administration.response_prompt" },
        values: ["Prompt"],
        dataName: "AD8",
        dataDescription: "Cognitive screening questionnaire.",
      },
    ];

    expect(buildDataReferenceMenuOptions("", suggestions)).toEqual([
      { kind: "data", dataId: "ad8", dataName: "AD8", description: "Cognitive screening questionnaire." },
    ]);
    expect(
      buildDataReferenceMenuOptions("AD8.", suggestions).map((option) =>
        option.kind === "path" ? option.segment : option.dataName,
      ),
    ).toEqual(["id", "administration"]);
    expect(
      buildDataReferenceMenuOptions("AD8.administration.", suggestions).map((option) =>
        option.kind === "path" ? option.segment : option.dataName,
      ),
    ).toEqual(["intro", "response_prompt"]);
  });

  it("keeps every Data root available when the workspace has more than twelve sources", () => {
    const suggestions: DataReferenceSuggestion[] = Array.from({ length: 14 }, (_, index) => ({
      expression: `@Data-${index + 1}.id`,
      reference: { kind: "data", dataId: `data-${index + 1}`, path: "id" },
      values: [`data_${index + 1}`],
      dataName: `Data-${index + 1}`,
    }));

    const options = buildDataReferenceMenuOptions("", suggestions);

    expect(options).toHaveLength(14);
    expect(options).toContainEqual(expect.objectContaining({ dataName: "Data-14" }));
  });

  it("browses arrays by index before showing child properties", () => {
    const suggestions: DataReferenceSuggestion[] = [
      {
        expression: "@AD8.items[0].id",
        reference: { kind: "data", dataId: "ad8", path: "items[0].id" },
        values: ["one"],
        dataName: "AD8",
      },
      {
        expression: "@AD8.items[1].id",
        reference: { kind: "data", dataId: "ad8", path: "items[1].id" },
        values: ["two"],
        dataName: "AD8",
      },
      {
        expression: "@AD8.items[].id",
        reference: { kind: "data", dataId: "ad8", path: "items[].id" },
        values: ["one", "two"],
        dataName: "AD8",
      },
    ];
    expect(buildDataReferenceMenuOptions("AD8.", suggestions)).toEqual([
      expect.objectContaining({ kind: "path", segment: "items", fullPath: "items[", isLeaf: false }),
    ]);
    expect(buildDataReferenceMenuOptions("AD8.items[", suggestions)).toEqual([
      expect.objectContaining({
        kind: "path",
        segment: "Use Dynamic Index",
        fullPath: "items[@",
        dynamicSelector: "index",
      }),
      expect.objectContaining({ kind: "path", segment: "0", fullPath: "items[0].", isLeaf: false }),
      expect.objectContaining({ kind: "path", segment: "1", fullPath: "items[1].", isLeaf: false }),
      expect.objectContaining({ kind: "path", segment: "All Items", fullPath: "items[].", wildcard: true }),
    ]);
    expect(buildDataReferenceMenuOptions("AD8.items[0].", suggestions)).toEqual([
      expect.objectContaining({ kind: "path", segment: "id", fullPath: "items[0].id", isLeaf: true }),
    ]);
  });

  it("browses a Data array with a runtime State index and keeps one binding token", () => {
    const suggestions: DataReferenceSuggestion[] = [
      {
        expression: "@PHQ-2.items[0].prompt",
        reference: { kind: "data", dataId: "phq-2", path: "items[0].prompt" },
        values: ["Question"],
        dataName: "PHQ-2",
      },
      {
        expression: "@PHQ-2.items[].prompt",
        reference: { kind: "data", dataId: "phq-2", path: "items[].prompt" },
        values: ["Question"],
        dataName: "PHQ-2",
      },
      {
        expression: "@state.screening.current_item_index",
        reference: { kind: "state", schemaKey: "on_call_state", path: "screening.current_item_index" },
        values: [0],
        dataName: "On Call State",
        sourceKind: "state",
      },
    ];
    const expression = "@PHQ-2.items[@state.screening.current_item_index].prompt";

    expect(buildDataReferenceMenuOptions("PHQ-2.items[@state.screening.current_item_index].", suggestions)).toEqual([
      expect.objectContaining({
        kind: "path",
        segment: "prompt",
        fullPath: "items[@state.screening.current_item_index].prompt",
        isLeaf: true,
      }),
    ]);
    expect(splitReferenceText(`Ask ${expression}`, suggestions)).toEqual([
      { kind: "text", value: "Ask " },
      expect.objectContaining({ kind: "reference", value: expression }),
    ]);
    expect(findReferenceQuery("@PHQ-2.items[@", 14)).toEqual({
      start: 13,
      end: 14,
      query: "",
      dynamicParents: [{ start: 0, continuation: "." }],
    });
  });

  it("uses a nested Data value as a dynamic object key", () => {
    const suggestions: DataReferenceSuggestion[] = [
      {
        expression: "@PHQ-2.items[0].response_set",
        reference: { kind: "data", dataId: "phq-2", path: "items[0].response_set" },
        values: ["frequency_past_two_weeks"],
        dataName: "PHQ-2",
      },
      {
        expression: "@PHQ-2.items[].response_set",
        reference: { kind: "data", dataId: "phq-2", path: "items[].response_set" },
        values: ["frequency_past_two_weeks"],
        dataName: "PHQ-2",
      },
      {
        expression: "@PHQ-2.response_sets.frequency_past_two_weeks[0].id",
        reference: { kind: "data", dataId: "phq-2", path: "response_sets.frequency_past_two_weeks[0].id" },
        values: ["not_at_all"],
        dataName: "PHQ-2",
      },
      {
        expression: "@PHQ-2.response_sets.frequency_past_two_weeks[].id",
        reference: { kind: "data", dataId: "phq-2", path: "response_sets.frequency_past_two_weeks[].id" },
        values: ["not_at_all", "several_days"],
        dataName: "PHQ-2",
      },
      {
        expression: "@state.screening.current_item_index",
        reference: { kind: "state", schemaKey: "on_call_state", path: "screening.current_item_index" },
        values: [0],
        dataName: "On Call State",
        sourceKind: "state",
      },
    ];
    const selector = "@PHQ-2.items[@state.screening.current_item_index].response_set";
    const expression = `@PHQ-2.response_sets[${selector}][].id`;

    expect(buildDataReferenceMenuOptions("PHQ-2.response_sets.", suggestions)).toContainEqual(
      expect.objectContaining({
        segment: "Use Dynamic Key",
        fullPath: "response_sets[@",
        dynamicSelector: "key",
        dynamicContinuation: "[",
      }),
    );
    expect(buildDataReferenceMenuOptions(`PHQ-2.response_sets[${selector}][`, suggestions)).toContainEqual(
      expect.objectContaining({ segment: "All Items", fullPath: `response_sets[${selector}][].`, wildcard: true }),
    );
    expect(buildDataReferenceMenuOptions(`PHQ-2.response_sets[${selector}][].`, suggestions)).toContainEqual(
      expect.objectContaining({ segment: "id", fullPath: `response_sets[${selector}][].id`, isLeaf: true }),
    );
    expect(splitReferenceText(expression, suggestions)).toEqual([
      expect.objectContaining({ kind: "reference", value: expression }),
    ]);
  });
});
