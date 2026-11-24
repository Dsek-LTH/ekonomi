import { describe, expect, it } from "vitest";
import { repointSteps, type UndoStep } from "./use-undo";

describe("repointSteps", () => {
  const steps: UndoStep[] = [
    {
      kind: "field",
      url: "/api/budget-line-items/old1",
      before: { expression: "1" },
      after: { expression: "2" },
      cell: "old1:expression",
    },
    {
      kind: "field",
      url: "/api/budget-line-items/other",
      before: { description: "a" },
      after: { description: "b" },
      cell: "other:description",
    },
    {
      kind: "line",
      created: false,
      accountId: "acc",
      lineId: "old1",
      body: { description: "x", expression: "1" },
      order: ["a", "old1", "b"],
    },
  ];

  it("points every step at a line's new id", () => {
    const [field, untouched, line] = repointSteps(steps, "old1", "new1");
    expect(field).toMatchObject({ url: "/api/budget-line-items/new1", cell: "new1:expression" });
    expect(untouched).toEqual(steps[1]);
    expect(line).toMatchObject({ lineId: "new1", order: ["a", "new1", "b"] });
  });

  it("leaves an id that only starts the same alone", () => {
    const [field] = repointSteps(steps, "old", "new");
    expect(field).toMatchObject({ url: "/api/budget-line-items/old1", cell: "old1:expression" });
  });
});
