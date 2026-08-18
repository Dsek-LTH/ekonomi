import { describe, expect, it } from "vitest";

import { rebindCopiedRefs, rebindFormula } from "./paste";

// What a copied block of rows should mean once it has been pasted: the copies
// read each other, and everything they read from outside the block is left
// pointing where it pointed.
const copied = new Map([
  ["old1", "new1"],
  ["old2", "new2"],
]);

describe("rebindFormula", () => {
  it("points a reference to a copied row at the copy", () => {
    expect(rebindFormula("@Lold1:expression * 2", copied)).toBe("@Lnew1:expression * 2");
  });

  it("leaves a reference to a row that was not copied alone", () => {
    expect(rebindFormula("@Lother:expression + 1", copied)).toBe("@Lother:expression + 1");
  });

  it("takes every reference in one equation", () => {
    expect(rebindFormula("@Lold1:expression + @Lold2:x1 + @Lelse:expression", copied)).toBe(
      "@Lnew1:expression + @Lnew2:x1 + @Lelse:expression",
    );
  });

  it("keeps the field the reference names", () => {
    expect(rebindFormula("@Lold2:x3", copied)).toBe("@Lnew2:x3");
  });

  it("has nothing to say about account totals or variables", () => {
    const f = "account(SEX02, 3015) * MEDLEMMAR";
    expect(rebindFormula(f, copied)).toBe(f);
  });
});

describe("rebindCopiedRefs", () => {
  const row = (over: Partial<Parameters<typeof rebindCopiedRefs>[0]> = {}) => ({
    expression: "0",
    quantity: null,
    unitPrice: null,
    values: {},
    ...over,
  });

  it("is null for a row that referred to nothing copied", () => {
    expect(rebindCopiedRefs(row({ expression: "2 * 350" }), copied)).toBeNull();
  });

  it("rewrites the equation, the antal × á-pris pair and the general columns", () => {
    const bound = rebindCopiedRefs(
      row({
        expression: "@Lold1:expression",
        quantity: "@Lold2:expression",
        unitPrice: "350",
        values: { x1: "@Lold1:x1", x2: "5" },
      }),
      copied,
    );
    expect(bound).toEqual({
      expression: "@Lnew1:expression",
      quantity: "@Lnew2:expression",
      unitPrice: "350",
      values: { x1: "@Lnew1:x1", x2: "5" },
    });
  });

  it("survives a row whose values column is not an object", () => {
    expect(rebindCopiedRefs(row({ expression: "@Lold1:expression", values: null }), copied)).toEqual({
      expression: "@Lnew1:expression",
      quantity: null,
      unitPrice: null,
      values: {},
    });
  });
});
