import { describe, expect, it } from "vitest";
import { expenseLabel, formatReference, nextReference, referencePrefix } from "./reference";

describe("reference format", () => {
  it("writes the year as two digits and pads the counter", () => {
    expect(formatReference(2026, 1)).toBe("D-26|0001");
    expect(formatReference(2026, 43)).toBe("D-26|0043");
  });

  it("keeps the prefix fixed-width, which is what lets the counter be sliced off", () => {
    expect(referencePrefix(2026)).toBe("D-26|");
    expect(referencePrefix(2009)).toBe("D-09|");
  });

  // Lists sort on this string, and the next number is the highest one plus one.
  // Both are only true while the format sorts the way it counts.
  it("sorts in counting order, within a year and across years", () => {
    const refs = [
      formatReference(2026, 100),
      formatReference(2025, 9999),
      formatReference(2026, 9),
      formatReference(2026, 1000),
    ];
    expect([...refs].sort()).toEqual([
      "D-25|9999",
      "D-26|0009",
      "D-26|0100",
      "D-26|1000",
    ]);
  });
});

describe("nextReference", () => {
  it("starts a year at 1", () => {
    expect(nextReference(2026, null)).toBe("D-26|0001");
  });

  it("counts on from the highest reference taken", () => {
    expect(nextReference(2026, "D-26|0042")).toBe("D-26|0043");
    expect(nextReference(2026, "D-26|0099")).toBe("D-26|0100");
  });

  // The counter outgrowing its padding is not an error: it stops being
  // zero-padded and keeps counting, and the year's own numbers still sort
  // among themselves because they're all wider than the padded ones.
  it("keeps counting past four digits", () => {
    expect(nextReference(2026, "D-26|9999")).toBe("D-26|10000");
  });

  it("starts over rather than yielding NaN when there is nothing to count from", () => {
    expect(nextReference(2026, "")).toBe("D-26|0001");
  });
});

describe("expenseLabel", () => {
  it("names an utlägg by its reference once it has one", () => {
    expect(expenseLabel({ id: "e_1", reference: "D-26|0042" })).toBe("D-26|0042");
  });

  it("falls back to the id, so a draft is still named", () => {
    expect(expenseLabel({ id: "e_1", reference: null })).toBe("e_1");
    expect(expenseLabel({ id: "e_1" })).toBe("e_1");
  });
});
