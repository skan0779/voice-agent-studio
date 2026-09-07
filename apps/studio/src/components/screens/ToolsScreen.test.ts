import { describe, expect, it } from "vitest";
import { toFunctionName } from "./ToolsScreen";

describe("toFunctionName", () => {
  it("preserves an underscore while a function name is being typed", () => {
    expect(toFunctionName("record_")).toBe("record_");
    expect(toFunctionName("record_screening_answer")).toBe("record_screening_answer");
  });

  it("normalizes display-name separators to underscores", () => {
    expect(toFunctionName("Record Screening Answer")).toBe("record_screening_answer");
  });
});
