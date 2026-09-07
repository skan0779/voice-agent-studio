import { describe, expect, it } from "vitest";
import {
  formatDataReference,
  listDataReferenceSuggestions,
  parseDataReferenceExpression,
  resolveDataReference,
} from "./dataReferences";
import type { DataAsset } from "./workspaces";

const assessment: DataAsset = {
  id: "phq-2",
  name: "PHQ-2",
  description: "Screening questions",
  sourceType: "text",
  format: "JSON",
  content: JSON.stringify({
    id: "phq_2",
    items: [
      { id: "phq_01", response_set: "frequency" },
      { id: "phq_02", response_set: "frequency" },
    ],
    response_sets: {
      frequency: [
        { id: "not_at_all", score: 0 },
        { id: "several_days", score: 1 },
      ],
    },
  }),
  updatedAt: "2026-08-25T00:00:00.000Z",
};

describe("data references", () => {
  it("offers scalar and wildcard JSON paths for @ autocomplete", () => {
    const suggestions = listDataReferenceSuggestions([assessment]);

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        expression: "@PHQ-2.response_sets.frequency[].id",
        values: ["not_at_all", "several_days"],
      }),
    );
    expect(suggestions).toContainEqual(expect.objectContaining({ expression: "@PHQ-2.id", values: ["phq_2"] }));
  });

  it("reads uploaded file-backed JSON the same way as text JSON", () => {
    const suggestions = listDataReferenceSuggestions([{ ...assessment, sourceType: "file", fileName: "phq-2.json" }]);
    expect(suggestions).toContainEqual(
      expect.objectContaining({
        expression: "@PHQ-2.response_sets.frequency[].id",
        values: ["not_at_all", "several_days"],
      }),
    );
  });

  it("stores references by stable data ID and resolves them after a display-name change", () => {
    const reference = parseDataReferenceExpression("@PHQ-2.response_sets.frequency[].score", [assessment]);
    expect(reference).toEqual({ kind: "data", dataId: "phq-2", path: "response_sets.frequency[].score" });
    expect(resolveDataReference(reference!, [{ ...assessment, name: "PHQ Depression Screener" }])).toEqual([0, 1]);
    expect(formatDataReference(reference!, [{ ...assessment, name: "PHQ Depression Screener" }])).toBe(
      "@PHQ Depression Screener.response_sets.frequency[].score",
    );
  });

  it("resolves a Data key selected indirectly by Data and runtime State", () => {
    const expression = "@PHQ-2.response_sets[@PHQ-2.items[@state.screening.current_item_index].response_set][].id";
    const reference = parseDataReferenceExpression(expression, [assessment]);

    expect(reference).toEqual({
      kind: "data",
      dataId: "phq-2",
      path: "response_sets[@PHQ-2.items[@state.screening.current_item_index].response_set][].id",
    });
    expect(
      resolveDataReference(reference!, [assessment], {
        screening: { current_item_index: 1 },
      }),
    ).toEqual(["not_at_all", "several_days"]);
  });
});
