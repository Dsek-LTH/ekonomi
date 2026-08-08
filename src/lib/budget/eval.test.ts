import { describe, expect, it } from "vitest";
import { evaluate, type LineItemInput, type VariableInput } from "./eval";

// The spreadsheet engine behind every budget figure. A wrong answer here is a
// wrong number in an adopted budget, so this covers the language itself, the
// way references resolve across sheets, and what happens when they can't.

// One line item on Sexmästeriet's 5010 account, unless a test says otherwise.
const line = (expression: string, id = "li1", accountKey = "SEX01:5010"): LineItemInput => ({
  id,
  accountKey,
  expression,
});

// The value the engine computed for one line item.
const valueOf = (expression: string, variables: VariableInput[] = []) =>
  evaluate(variables, [line(expression)]).lineItems.get("li1");

// Kronor → öre. The engine reports money in öre (see the units note in
// eval.ts), and a budget is written in kronor, so the assertions below say what
// the sheet says and this converts. Written out rather than hidden inside
// `valueOf`, because which numbers here are money and which are not — a
// variable holding a headcount is not — is exactly the distinction the units
// change turns on.
const kr = (n: number) => Math.round(n * 100);

describe("cell values", () => {
  it("reads a bare number as a literal", () => {
    expect(valueOf("350")).toBe(kr(350));
    expect(valueOf("0")).toBe(0);
    expect(valueOf("-120")).toBe(kr(-120));
  });

  it("reads Swedish and typed-in number formats", () => {
    expect(valueOf("1234,50")).toBe(kr(1234.5));
    expect(valueOf("2_000")).toBe(kr(2000));
  });

  it("reads a trailing percent as a fraction", () => {
    // "67%" is how a share is written in the sheet; downstream formulas
    // multiply by it.
    expect(valueOf("67%")).toBe(kr(0.67));
    expect(valueOf("100%")).toBe(kr(1));
  });

  it("treats an empty or non-numeric cell as unresolved", () => {
    expect(valueOf("")).toBe(0);
    expect(valueOf("ungefär 300")).toBe(0);
    // …and says which rows those were, so the sheet can flag them.
    expect(evaluate([], [line("")]).badLineItems).toEqual(["li1"]);
    expect(evaluate([], [line("350")]).badLineItems).toEqual([]);
  });
});

describe("arithmetic", () => {
  it("computes a formula after the leading =", () => {
    expect(valueOf("=350*2")).toBe(kr(700));
    expect(valueOf("=1000-250")).toBe(kr(750));
    expect(valueOf("=900/3")).toBe(kr(300));
  });

  it("applies multiplication before addition", () => {
    expect(valueOf("=2+3*4")).toBe(kr(14));
    expect(valueOf("=(2+3)*4")).toBe(kr(20));
  });

  it("handles a leading minus", () => {
    expect(valueOf("=-5*2")).toBe(kr(-10));
  });

  it("accepts the typographic × and ÷ a spreadsheet paste brings along", () => {
    expect(valueOf("=6×7")).toBe(kr(42));
    expect(valueOf("=84÷2")).toBe(kr(42));
  });

  it("refuses to divide by zero rather than returning Infinity", () => {
    // Infinity would sum into an account total and poison the whole sheet;
    // NaN marks the one row as bad instead.
    expect(evaluate([], [line("=100/0")]).badLineItems).toEqual(["li1"]);
  });
});

describe("variables", () => {
  const members: VariableInput = { name: "MEDLEMMAR", expression: "150" };

  it("resolves a named variable", () => {
    expect(valueOf("=MEDLEMMAR*20", [members])).toBe(kr(3000));
  });

  it("lets a variable be defined in terms of an earlier one", () => {
    const vars = [members, { name: "HALVA", expression: "=MEDLEMMAR/2" }];
    expect(evaluate(vars, []).vars.get("HALVA")).toBe(75);
  });

  it("flags a variable that does not resolve", () => {
    const result = evaluate([{ name: "TROT", expression: "=SAKNAS*2" }], []);
    expect(result.badVariables).toEqual(["TROT"]);
  });

  it("flags a row that references a variable nobody defined", () => {
    expect(evaluate([], [line("=SAKNAS*2")]).badLineItems).toEqual(["li1"]);
  });
});

describe("account totals", () => {
  it("sums the rows on each account", () => {
    const result = evaluate([], [
      line("100", "a"),
      line("250", "b"),
      line("40", "c", "KM01:5010"),
    ]);
    expect(result.accounts.get("SEX01:5010")).toBe(kr(350));
    expect(result.accounts.get("KM01:5010")).toBe(kr(40));
  });

  it("lets a formula read another sheet's account total", () => {
    // account(CC, KONTO) is what makes a rambudget row follow the sheet it
    // summarises instead of being retyped.
    const result = evaluate([], [
      line("300", "a", "SEX01:5010"),
      line("200", "b", "SEX01:5010"),
      line("=account(SEX01, 5010)", "summary", "RAM:5010"),
    ]);
    expect(result.lineItems.get("summary")).toBe(kr(500));
  });

  it("reads an account the budget holds but put no rows on as zero", () => {
    // A budget references accounts that are simply empty this year; that is
    // not a broken formula.
    const result = evaluate([], [line("=account(SEX01, 9999)")], [], [], ["SEX01:9999"]);
    expect(result.lineItems.get("li1")).toBe(0);
    expect(result.badLineItems).toEqual([]);
  });

  it("flags an account the budget doesn't hold at all", () => {
    // The other half of the rule above: nothing to sum *and* no such account is
    // a reference to something that isn't there, which reads like any other
    // unresolved name rather than like a confident zero.
    const result = evaluate([], [line("=account(SEX01, 9999)")], [], [], ["SEX01:5010"]);
    expect(result.lineItems.get("li1")).toBe(0); // unresolved cells hold 0
    expect(result.badLineItems).toEqual(["li1"]);
  });

  it("resolves a cost-centre code with Å/Ä/Ö or a hyphen in it", () => {
    // Codes come from Fortnox and from the settings screen, both of which allow
    // them (see POST /api/cost-centers). Lexed as an identifier, "NÄRU" became
    // the two names N and RU and the lookup silently missed.
    const result = evaluate([], [
      line("400", "a", "NÄRU:3010"),
      line("=account(NÄRU, 3010)", "ref", "SEX01:5010"),
      line("60", "b", "KM-01:3010"),
      line("=account(KM-01, 3010)", "hyphen", "SEX01:5010"),
    ]);
    expect(result.lineItems.get("ref")).toBe(kr(400));
    expect(result.lineItems.get("hyphen")).toBe(kr(60));
    expect(result.badLineItems).toEqual([]);
  });

  it("resolves a cost-centre code that leads with a digit", () => {
    const result = evaluate([], [
      line("250", "a", "100:3010"),
      line("=account(100, 3010)", "ref", "SEX01:5010"),
    ]);
    expect(result.lineItems.get("ref")).toBe(kr(250));
    expect(result.badLineItems).toEqual([]);
  });

  it("resolves a variable named with Å/Ä/Ö", () => {
    // Variable names are never validated — only uppercased — so this is
    // reachable, and half-lexing one resolved it to a different, missing name.
    expect(valueOf("=ÅRSAVGIFT*2", [{ name: "ÅRSAVGIFT", expression: "150" }])).toBe(kr(300));
  });

  it("resolves a chain from an account through a variable into a row", () => {
    const result = evaluate(
      [{ name: "SEXTOTAL", expression: "=account(SEX01, 5010)" }],
      [line("1000", "a", "SEX01:5010"), line("=SEXTOTAL*0.5", "half", "KM01:5010")],
    );
    expect(result.lineItems.get("half")).toBe(kr(500));
  });
});

describe("editorial adjustments", () => {
  it("adds a decided change on top of the rows", () => {
    const result = evaluate([], [line("1000")], [], [{ accountKey: "SEX01:5010", amount: kr(250) }]);
    expect(result.accounts.get("SEX01:5010")).toBe(kr(1250));
  });

  it("creates the total for an account the sheet never budgeted", () => {
    // A förflyttning may fund a post that has no rows at all.
    const result = evaluate([], [], [], [{ accountKey: "SEX01:6000", amount: kr(500) }]);
    expect(result.accounts.get("SEX01:6000")).toBe(kr(500));
  });

  it("is visible to formulas that read the account", () => {
    // The point of folding adjustments in before evaluation: a reference reads
    // the figure in force, not the one originally adopted.
    const result = evaluate(
      [],
      [line("1000", "a", "SEX01:5010"), line("=account(SEX01, 5010)", "ref", "RAM:5010")],
      [],
      [{ accountKey: "SEX01:5010", amount: kr(250) }],
    );
    expect(result.lineItems.get("ref")).toBe(kr(1250));
  });
});

describe("references between cells", () => {
  it("reads another row's amount", () => {
    const result = evaluate([], [line("400", "source"), { ...line("=@Lsource:expression*2", "double") }]);
    expect(result.lineItems.get("double")).toBe(kr(800));
  });

  it("reads a per-line value from a user-defined column", () => {
    const rows: LineItemInput[] = [
      { id: "row", accountKey: "SEX01:5010", expression: "=@Lrow:x1*10", values: { x1: "25" } },
    ];
    expect(evaluate([], rows, ["x1"]).lineItems.get("row")).toBe(kr(250));
  });
});

describe("circular references", () => {
  it("gives up rather than looping forever, and says so", () => {
    const result = evaluate([{ name: "SPIRAL", expression: "=SPIRAL+1" }], []);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toBe("circular");
  });

  it("leaves a settled budget free of warnings", () => {
    const result = evaluate(
      [{ name: "MEDLEMMAR", expression: "150" }],
      [line("=MEDLEMMAR*20")],
    );
    expect(result.errors).toEqual([]);
    expect(result.badLineItems).toEqual([]);
    expect(result.badVariables).toEqual([]);
  });
});

describe("a formula is read whole or not at all", () => {
  // The parser used to stop wherever it stopped understanding and hand back
  // what it had read so far. Every case below therefore had an answer — a
  // plausible, confident, wrong one — and nothing anywhere said so.

  it("rejects a formula with something left over after it", () => {
    expect(valueOf("=350 kr")).toBe(0);
    expect(evaluate([], [line("=350 kr")]).badLineItems).toEqual(["li1"]);
  });

  it("rejects two numbers with nothing joining them", () => {
    // Read as "100" before, which is the sort of thing you find in March.
    expect(evaluate([], [line("=100 200")]).badLineItems).toEqual(["li1"]);
  });

  it("rejects a group that is never closed", () => {
    expect(evaluate([], [line("=(1+2")]).badLineItems).toEqual(["li1"]);
    expect(evaluate([], [line("=2*(3+4")]).badLineItems).toEqual(["li1"]);
  });

  it("rejects a character the language has no meaning for", () => {
    expect(evaluate([], [line("=350 $")]).badLineItems).toEqual(["li1"]);
    expect(evaluate([], [line("=#350")]).badLineItems).toEqual(["li1"]);
  });

  it("still accepts the whole language it always did", () => {
    // The strictness is only about what is left over — nothing valid moved.
    expect(valueOf("=(2+3)*4")).toBe(kr(20));
    expect(valueOf("= 350 * 2 ")).toBe(kr(700));
    expect(valueOf("=6×7")).toBe(kr(42));
    expect(evaluate([], [line("1234,50"), line("2_000", "li2")]).badLineItems).toEqual([]);
  });
});

describe("an unresolvable cell does not pass for zero", () => {
  it("makes the row that reads it unresolved too", () => {
    // Previously: the broken row was flagged, and the row doubling it quietly
    // returned 0 — a clean number with nothing to suggest it was wrong.
    const result = evaluate([], [
      line("ungefär 300", "source"),
      line("=@Lsource:expression*2", "double"),
    ]);
    expect(result.badLineItems).toEqual(["source", "double"]);
  });

  it("carries the failure down a chain of references", () => {
    const result = evaluate([], [
      line("=SAKNAS", "a"),
      line("=@La:expression", "b"),
      line("=@Lb:expression+1", "c"),
    ]);
    expect(result.badLineItems).toEqual(["a", "b", "c"]);
  });

  it("leaves a row reading a cell that resolved alone", () => {
    const result = evaluate([], [
      line("400", "source"),
      line("=@Lsource:expression*2", "double"),
    ]);
    expect(result.badLineItems).toEqual([]);
    expect(result.lineItems.get("double")).toBe(kr(800));
  });

  it("treats an empty general column as empty rather than broken", () => {
    // Most rows fill in none of the six. Flagging them would poison every
    // formula that reads across a row.
    const rows: LineItemInput[] = [
      { id: "row", accountKey: "SEX01:5010", expression: "100", values: {} },
    ];
    expect(evaluate([], rows, ["x1"]).badLineItems).toEqual([]);
  });
});

describe("an account total says when it is short a row", () => {
  it("names the account and still sums what resolved", () => {
    const result = evaluate([], [
      line("=fel kr", "broken"),
      line("1200", "fine"),
    ]);
    // The figure is the rows that worked — a sheet you cannot read is no help
    // in finding the row to fix — and the account is marked as partial.
    expect(result.accounts.get("SEX01:5010")).toBe(kr(1200));
    expect(result.badAccounts).toEqual(["SEX01:5010"]);
  });

  it("leaves a whole account unmarked", () => {
    const result = evaluate([], [line("100", "a"), line("250", "b")]);
    expect(result.badAccounts).toEqual([]);
  });

  it("marks only the accounts that are actually short", () => {
    const result = evaluate([], [
      line("=trasig", "a", "SEX01:5010"),
      line("500", "b", "KM01:5010"),
    ]);
    expect(result.badAccounts).toEqual(["SEX01:5010"]);
  });
});

describe("the cells are part of the fixed point", () => {
  it("reports a cell cycle that never settles", () => {
    // Two rows defined in terms of each other. The convergence test used to
    // look at variables and account totals only, so this settled "stable" with
    // whatever the last pass held and no warning at all.
    const result = evaluate([], [
      line("=@Lb:expression+1", "a"),
      line("=@La:expression+1", "b"),
    ]);
    expect(result.errors).toEqual(["circular"]);
  });

  it("still lets a long but finite chain resolve", () => {
    const chain: LineItemInput[] = [line("1", "n0")];
    for (let i = 1; i < 6; i++) {
      chain.push(line(`=@Ln${i - 1}:expression+1`, `n${i}`));
    }
    const result = evaluate([], chain);
    expect(result.errors).toEqual([]);
    expect(result.lineItems.get("n5")).toBe(kr(6));
  });
});

describe("money comes out as exact öre", () => {
  it("sums rows that do not survive being added as kronor", () => {
    // 0.1 + 0.2 is not 0.3 in binary floating point, and a sheet with a
    // hundred such rows was quietly out by a fraction of an öre — enough for
    // an account total to disagree with the rows printed above it, and enough
    // for a förflyttning that ought to net to zero not to.
    const rows = Array.from({ length: 100 }, (_, i) => line("0,10", `r${i}`));
    const result = evaluate([], rows);
    expect(result.accounts.get("SEX01:5010")).toBe(kr(10));

    // The same sum done the old way, for the record.
    const asFloats = rows.reduce((sum) => sum + 0.1, 0);
    expect(asFloats).not.toBe(10);
  });

  it("rounds each row once, where the amount is settled", () => {
    // A third decimal is not a smaller amount, it is one öre either way. It is
    // decided per row rather than carried into the total and rounded at the
    // end, so the total is always exactly the sum of the figures on screen.
    const result = evaluate([], [
      line("=10/3", "a"),
      line("=10/3", "b"),
      line("=10/3", "c"),
    ]);
    expect(result.lineItems.get("a")).toBe(333);
    expect(result.accounts.get("SEX01:5010")).toBe(999); // not 1000
  });

  it("leaves a percentage a ratio rather than scaling it", () => {
    // The reason the arithmetic is not simply done in öre: scaling the whole
    // value space would make 67% into 67, and every formula built on a share a
    // hundred times too large.
    const result = evaluate(
      [{ name: "ANDEL", expression: "67%" }],
      [line("=1000*ANDEL", "share")],
    );
    expect(result.vars.get("ANDEL")).toBe(0.67);
    expect(result.lineItems.get("share")).toBe(kr(670));
  });

  it("keeps a headcount a headcount", () => {
    const result = evaluate(
      [{ name: "MEDLEMMAR", expression: "150" }],
      [line("=MEDLEMMAR*20", "row")],
    );
    expect(result.vars.get("MEDLEMMAR")).toBe(150);
    expect(result.lineItems.get("row")).toBe(kr(3000));
  });
});
