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

describe("repointSteps on a block paste", () => {
  it("points every cell of a fields step on the remade line at its new id", () => {
    const [step] = repointSteps(
      [
        {
          kind: "fields",
          steps: [
            {
              url: "/api/budget-line-items/old",
              before: { expression: "1" },
              after: { expression: "2" },
            },
            {
              url: "/api/budget-line-items/other",
              before: { description: "a" },
              after: { description: "b" },
            },
          ],
        },
      ],
      "old",
      "new",
    );
    expect(step.kind === "fields" && step.steps.map((s) => s.url)).toEqual([
      "/api/budget-line-items/new",
      "/api/budget-line-items/other",
    ]);
  });
});

describe("repointSteps on a group", () => {
  it("reaches the steps inside it", () => {
    const [group] = repointSteps(
      [
        {
          kind: "group",
          steps: [
            {
              kind: "fields",
              steps: [{ url: "/api/budget-line-items/old", before: {}, after: {} }],
            },
            {
              kind: "line",
              created: true,
              accountId: "a",
              lineId: "old",
              body: { description: "x", expression: "1" },
              order: ["k", "old"],
            },
          ],
        },
      ],
      "old",
      "new",
    );
    expect(group.kind === "group" && group.steps).toEqual([
      { kind: "fields", steps: [{ url: "/api/budget-line-items/new", before: {}, after: {} }] },
      {
        kind: "line",
        created: true,
        accountId: "a",
        lineId: "new",
        body: { description: "x", expression: "1" },
        order: ["k", "new"],
      },
    ]);
  });
});

describe("repointSteps on lines made or deleted together", () => {
  it("renames the line and its place in the account's order", () => {
    const [step] = repointSteps(
      [
        {
          kind: "lines",
          created: false,
          lines: [
            { accountId: "a", lineId: "old", body: { description: "x", expression: "1" } },
            { accountId: "a", lineId: "keep", body: { description: "y", expression: "2" } },
          ],
          orders: [{ accountId: "a", ids: ["p", "old", "keep"] }],
        },
      ],
      "old",
      "new",
    );
    expect(step.kind === "lines" && step.lines.map((l) => l.lineId)).toEqual(["new", "keep"]);
    expect(step.kind === "lines" && step.orders[0].ids).toEqual(["p", "new", "keep"]);
  });
});
