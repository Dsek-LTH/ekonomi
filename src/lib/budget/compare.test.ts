import { describe, expect, it } from "vitest";
import {
  budgetLabel,
  compareKey,
  joinSnapshots,
  lineKeys,
  sheetTotals,
  type CompareAccount,
  type Snapshot,
} from "./compare";

const account = (
  code: string,
  kind: "INCOME" | "COST",
  total: number,
  lines: { key: string; description: string; value: number }[] = [],
): CompareAccount => ({ code, name: `Konto ${code}`, kind, total, lines });

const side = (id: string, sheets: Snapshot["sheets"], vars: Record<string, number> = {}): Snapshot =>
  ({ id, label: id, sheets, vars });

describe("compareKey", () => {
  // The cost-centre code is the one thing that means the same in every budget.
  it("matches a linked sheet on its cost-centre code", () => {
    expect(compareKey({ id: "x", costCenter: { code: "SEX02" } })).toBe("SEX02");
  });

  it("matches a detached sheet on its label, forgiving case and spacing", () => {
    const a = compareKey({ id: "a", label: "Gemensamma  Kostnader" });
    const b = compareKey({ id: "b", label: "gemensamma kostnader" });
    expect(a).toBe(b);
  });

  // The honest answer: there is nothing to recognise it by.
  it("falls back to the sheet's own id when it has no name, so it matches nothing", () => {
    expect(compareKey({ id: "a", label: "  " })).toBe("#a");
    expect(compareKey({ id: "a" })).not.toBe(compareKey({ id: "b" }));
  });

  it("prefers the code over the label when a sheet has both", () => {
    expect(compareKey({ id: "x", label: "Något", costCenter: { code: "SEX02" } })).toBe("SEX02");
  });
});

describe("lineKeys", () => {
  it("matches rows on their description", () => {
    expect(lineKeys([{ description: "Tröjor" }])).toEqual(["tröjor"]);
  });

  it("is forgiving about case and runs of whitespace", () => {
    expect(lineKeys([{ description: "  Mat   och  dryck " }])).toEqual(["mat och dryck"]);
  });

  // The n-th "Övrigt" can only be known in the context of the rest, which is
  // why this takes the whole account at once.
  it("tells repeated descriptions apart by their position", () => {
    expect(lineKeys([
      { description: "Övrigt" },
      { description: "Tröjor" },
      { description: "Övrigt" },
    ])).toEqual(["övrigt", "tröjor", "övrigt~1"]);
  });
});

describe("joinSnapshots", () => {
  it("puts each side's figure in its own column", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sexmästeriet", resultUnit: "Sex", accounts: [account("4010", "COST", 100)] }]),
      side("b", [{ key: "SEX02", name: "Sexmästeriet", resultUnit: "Sex", accounts: [account("4010", "COST", 150)] }]),
    ]);
    expect(joined.sheets).toHaveLength(1);
    expect(joined.sheets[0].accounts[0].totals).toEqual([100, 150]);
  });

  // The blank is usually the finding, so it is never a reason to drop the row.
  it("keeps a sheet only one side has, blank in the other column", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 100)] }]),
      side("b", [{ key: "KM01", name: "Källaren", resultUnit: null, accounts: [account("4010", "COST", 50)] }]),
    ]);
    expect(joined.sheets.map((s) => s.key)).toEqual(["SEX02", "KM01"]);
    expect(joined.sheets[0].accounts[0].totals).toEqual([100, undefined]);
    expect(joined.sheets[1].accounts[0].totals).toEqual([undefined, 50]);
  });

  it("records which sides have a sheet at all, a sheet may exist and total zero", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 0)] }]),
      side("b", []),
    ]);
    expect(joined.sheets[0].present).toEqual([true, false]);
    // Present with a zero total is not the same as absent.
    expect(joined.sheets[0].accounts[0].totals).toEqual([0, undefined]);
  });

  it("keeps an account only the second side has", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 100)] }]),
      side("b", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [
        account("4010", "COST", 100), account("4020", "COST", 25),
      ] }]),
    ]);
    const codes = joined.sheets[0].accounts.map((a) => a.code);
    expect(codes).toEqual(["4010", "4020"]);
    expect(joined.sheets[0].accounts[1].totals).toEqual([undefined, 25]);
  });

  it("joins the rows inside an account", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [
        account("4010", "COST", 100, [{ key: "tröjor", description: "Tröjor", value: 100 }]),
      ] }]),
      side("b", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [
        account("4010", "COST", 130, [
          { key: "tröjor", description: "Tröjor", value: 80 },
          { key: "märken", description: "Märken", value: 50 },
        ]),
      ] }]),
    ]);
    const lines = joined.sheets[0].accounts[0].lines;
    expect(lines.map((l) => l.key)).toEqual(["tröjor", "märken"]);
    expect(lines[0].values).toEqual([100, 80]);
    expect(lines[1].values).toEqual([undefined, 50]);
  });

  // The budget in front of you keeps its own arrangement and its own wording.
  it("takes order and labels from the first side that mentions something", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sexmästeriet", resultUnit: null, accounts: [account("4010", "COST", 1)] }]),
      side("b", [{ key: "SEX02", name: "Sexet (omdöpt)", resultUnit: null, accounts: [account("4010", "COST", 2)] }]),
    ]);
    expect(joined.sheets[0].name).toBe("Sexmästeriet");
    expect(joined.sheets[0].accounts[0].name).toBe("Konto 4010");
  });

  it("fills in a result unit from a later side when the first has none", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [] }]),
      side("b", [{ key: "SEX02", name: "Sex", resultUnit: "Sexmästeriet", accounts: [] }]),
    ]);
    expect(joined.sheets[0].resultUnit).toBe("Sexmästeriet");
  });

  it("joins variables on the name alone", () => {
    const joined = joinSnapshots([
      side("a", [], { TROJA_POLICY: 250, MEDLEMMAR: 900 }),
      side("b", [], { TROJA_POLICY: 300 }),
    ]);
    expect(joined.vars).toEqual([
      { name: "TROJA_POLICY", values: [250, 300] },
      { name: "MEDLEMMAR", values: [900, undefined] },
    ]);
  });

  it("joins any number of sides", () => {
    const joined = joinSnapshots([
      side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 1)] }]),
      side("b", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 2)] }]),
      side("c", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [account("4010", "COST", 3)] }]),
    ]);
    expect(joined.sheets[0].accounts[0].totals).toEqual([1, 2, 3]);
  });

  it("joins nothing into nothing", () => {
    expect(joinSnapshots([])).toEqual({ sheets: [], vars: [] });
  });
});

describe("sheetTotals", () => {
  const joined = joinSnapshots([
    side("a", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [
      account("3010", "INCOME", 1000),
      account("4010", "COST", 400),
    ] }]),
    side("b", [{ key: "SEX02", name: "Sex", resultUnit: null, accounts: [
      account("3010", "INCOME", 800),
    ] }]),
  ]);

  it("splits income from cost and takes the difference", () => {
    expect(sheetTotals(joined.sheets[0], 0)).toEqual({ income: 1000, cost: 400, result: 600 });
  });

  it("counts an account the side doesn't have as zero", () => {
    expect(sheetTotals(joined.sheets[0], 1)).toEqual({ income: 800, cost: 0, result: 800 });
  });
});

describe("budgetLabel", () => {
  // Several budgets share a year, so the year alone doesn't identify one.
  it("leads with the year and then names the budget", () => {
    expect(budgetLabel({ year: 2026, name: "Ursprunglig" })).toBe("2026 - Ursprunglig");
  });

  it("names the financial year, not the year it was adopted in", () => {
    // A year's ordinary budget is passed before that year begins, so the two
    // are routinely different years, and the financial year is the one that
    // decides which ledger the budget is measured against.
    const budget = { year: 2026, name: "Ursprunglig", adoptedAt: "2025-11-14" };
    expect(budgetLabel(budget)).toBe("2026 - Ursprunglig");
  });
});
