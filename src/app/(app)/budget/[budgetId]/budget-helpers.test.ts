import { describe, expect, it } from "vitest";
import {
  CHANGES,
  editFormula,
  fmt,
  RAMBUDGET,
  VARS,
  formulaIdleText,
  normalizeFormula,
  prettyFormula,
  sheetFromUrl,
  sheetSearch,
} from "./budget-helpers";

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

describe("the open sheet in the address", () => {
  it("reads the words and passes an id through", () => {
    expect(sheetFromUrl(undefined)).toBeNull();
    expect(sheetFromUrl("variables")).toBe(VARS);
    expect(sheetFromUrl("changes")).toBe(CHANGES);
    expect(sheetFromUrl("ckabc123")).toBe("ckabc123");
  });

  it("writes a sheet, and keeps it while the Rambudget is open", () => {
    expect(sheetSearch("", "ckabc123")).toBe("sheet=ckabc123");
    expect(sheetSearch("sheet=ckabc123", RAMBUDGET)).toBe("sheet=ckabc123&view=frame");
    expect(sheetSearch("sheet=ckabc123&view=frame", VARS)).toBe("sheet=variables");
  });

  it("leaves other parameters alone", () => {
    expect(sheetSearch("x=1", CHANGES)).toBe("x=1&sheet=changes");
  });
});

describe("normalizeFormula and row references", () => {
  it("makes a bare reference a formula", () => {
    expect(normalizeFormula("#5")).toBe("=#5");
    expect(normalizeFormula("SEX01#5")).toBe("=SEX01#5");
  });

  it("reads x as multiplication before a reference", () => {
    expect(normalizeFormula("2x#5")).toBe("=2*#5");
  });
});

describe("fmt", () => {
  it("shows öre when there are some, and no decimals when there are none", () => {
    expect(fmt(70000)).toBe("700");
    expect(fmt(1250)).toBe("12,50");
    expect(fmt(1234)).toBe("12,34");
    expect(fmt(-1234)).toBe("−12,34");
    // sv-SE groups thousands with a no-break space.
    expect(fmt(123456789)).toBe("1\u00a0234\u00a0567,89");
  });
});

describe("a formula shown for editing comes back as stored", () => {
  it.each(["=5-3", "=2*TROJA_POLICY", "=10/4", "=#6-#7", "=2.5*#5", "=account(SEX01, 3010)*1.25"])(
    "%s survives prettyFormula then normalizeFormula",
    (stored) => {
      expect(normalizeFormula(prettyFormula(stored))).toBe(stored);
    },
  );

  it("shows a decimal comma and reads one back", () => {
    expect(prettyFormula("=2.5*3")).toBe("2,5 × 3");
    expect(normalizeFormula("2,5x3")).toBe("=2.5*3");
    expect(normalizeFormula("=12,50*2")).toBe("=12.50*2");
  });

  it("keeps the comma inside account(…)", () => {
    expect(normalizeFormula("=account(SEX01,3010)*2")).toBe("=account(SEX01,3010)*2");
  });
});

describe("editFormula", () => {
  it("shows a formula as it is typed", () => {
    expect(editFormula("=2*4")).toBe("2*4");
    expect(editFormula("=#6-#7")).toBe("#6-#7");
    expect(editFormula("=2.5*3")).toBe("2,5*3");
    expect(editFormula("=2*TROJA_POLICY")).toBe("2*TROJA_POLICY");
  });

  it("keeps the = where leaving it out would change what is stored", () => {
    expect(editFormula("=5")).toBe("=5");
  });

  it.each([
    "=2*4",
    "=5-3",
    "=#6-#7",
    "=2.5*#5",
    "=5",
    "=account(SEX01, 3010)*1.25",
    "=TROJA_POLICY",
  ])("%s comes back unchanged when saved untouched", (stored) => {
    expect(normalizeFormula(editFormula(stored))).toBe(stored);
  });
});
