import { describe, expect, it } from "vitest";
import { amountForCopy, clampToAccount } from "./use-range-select";

describe("amountForCopy", () => {
  it("writes öre as kronor with a decimal comma, as a spreadsheet reads it", () => {
    expect(amountForCopy(1125000)).toBe("11250,00");
    expect(amountForCopy(-4550)).toBe("-45,50");
  });

  it("leaves a cell with no value empty", () => {
    expect(amountForCopy(undefined)).toBe("");
    expect(amountForCopy(NaN)).toBe("");
  });
});

describe("clampToAccount", () => {
  // Two accounts: A holds a1-a3, B holds b1-b2, drawn one after the other.
  const order = ["a1", "a2", "a3", "b1", "b2"];
  const accountOf = (line: string) => line[0];

  it("keeps a line in the anchor's own account", () => {
    expect(clampToAccount(order, accountOf, "a1", "a3")).toBe("a3");
  });

  it("stops at the account's last line when dragged into the next account", () => {
    expect(clampToAccount(order, accountOf, "a2", "b2")).toBe("a3");
  });

  it("stops at the account's first line when dragged into the one above", () => {
    expect(clampToAccount(order, accountOf, "b2", "a1")).toBe("b1");
  });
});
