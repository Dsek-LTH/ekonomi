import { describe, expect, it } from "vitest";

import { effectiveKind, isResultAccount } from ".";

// Which accounts a budget may hold, and which side of the sheet they sit on.
// Both used to be one lenient rule ("3xxx is income, everything else is a
// cost"), which quietly accepted a bank account as an expense and let a
// per-account override put a cost under Intäkter.

describe("isResultAccount", () => {
  it("takes the resultaträkning, 3xxx through 8xxx", () => {
    for (const code of ["3010", "4010", "5800", "6071", "7010", "8410"]) {
      expect(isResultAccount(code)).toBe(true);
    }
  });

  it("refuses the balansräkning", () => {
    // 1930 is the bank account. It was pickable, and `effectiveKind` called it
    // a cost, so a section's cash could sit in a column of expenses with
    // nothing on the page to say it did not belong there.
    expect(isResultAccount("1930")).toBe(false);
    expect(isResultAccount("1510")).toBe(false);
    expect(isResultAccount("2440")).toBe(false);
    expect(isResultAccount("2010")).toBe(false);
  });

  it("refuses what is not an account at all", () => {
    expect(isResultAccount("")).toBe(false);
    expect(isResultAccount("konto")).toBe(false);
    expect(isResultAccount("9999")).toBe(false);
  });

  it("ignores space around the code", () => {
    expect(isResultAccount("  3010 ")).toBe(true);
    expect(isResultAccount(" 1930")).toBe(false);
  });
});

describe("effectiveKind", () => {
  it("puts 3xxx on the income side", () => {
    expect(effectiveKind("3010")).toBe("INCOME");
    expect(effectiveKind("3999")).toBe("INCOME");
  });

  it("puts everything the sheet can hold besides on the cost side", () => {
    expect(effectiveKind("4010")).toBe("COST");
    expect(effectiveKind("5800")).toBe("COST");
    expect(effectiveKind("8410")).toBe("COST");
  });

  it("still answers for a balance account already on a sheet", () => {
    // Total on purpose. New ones are refused, but a sheet saved before that
    // rule has to keep rendering, and it reads exactly as it did then.
    expect(effectiveKind("1930")).toBe("COST");
  });

  it("is the code's answer and nothing else's", () => {
    // There is no second argument any more. An override used to win here, set
    // by dragging an account card to the other section, which is how a cost
    // account came to be budgeted as income.
    expect(effectiveKind.length).toBe(1);
  });
});
