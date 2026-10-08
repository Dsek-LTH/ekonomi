import { describe, expect, it } from "vitest";
import { formulaIdleText } from "./budget-helpers";

// What a budget cell reads when nobody is editing it. Each case is one branch
// of the rule, in the order the rule takes them.
describe("formulaIdleText", () => {
  const cell = {
    raw: "=2*TROJA_POLICY",
    pretty: "2 × TROJA_POLICY",
    value: "700",
    asFormula: false,
    compact: false,
  };

  it("shows the placeholder in an empty cell, whatever else is true", () => {
    expect(formulaIdleText({ ...cell, raw: "  ", placeholder: "0", bad: true })).toBe("0");
    expect(formulaIdleText({ ...cell, raw: "" })).toBe("");
  });

  it("shows the formula itself on a cell drawn as one", () => {
    expect(formulaIdleText({ ...cell, asFormula: true })).toBe("2 × TROJA_POLICY");
    // A plain number has no pretty form, so it is shown as typed.
    expect(formulaIdleText({ ...cell, raw: "350", pretty: "", asFormula: true })).toBe("350");
  });

  it("says fel for a formula that does not evaluate", () => {
    expect(formulaIdleText({ ...cell, bad: true })).toBe("fel");
  });

  it("shows the working and the answer for a formula on a wide screen", () => {
    expect(formulaIdleText(cell)).toBe("2 × TROJA_POLICY = 700");
  });

  it("shows the answer alone on a phone, or for a plain number", () => {
    expect(formulaIdleText({ ...cell, compact: true })).toBe("700");
    expect(formulaIdleText({ ...cell, raw: "700", pretty: "700" })).toBe("700");
  });
});
