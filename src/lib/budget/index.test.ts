import { describe, expect, it } from "vitest";

import { effectiveKind, isResultAccount } from ".";

describe("isResultAccount", () => {
  it("takes the resultaträkning, 3xxx through 8xxx", () => {
    for (const code of ["3010", "4010", "5800", "6071", "7010", "8410"]) {
      expect(isResultAccount(code)).toBe(true);
    }
  });

  it("refuses the balansräkning", () => {
    // 1930 is a bank account: balance accounts are not budgeted.
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
    // Total: a sheet saved before the rule must keep rendering.
    expect(effectiveKind("1930")).toBe("COST");
  });

  it("is the code's answer and nothing else's", () => {
    expect(effectiveKind.length).toBe(1);
  });
});
