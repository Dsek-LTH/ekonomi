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

describe("cell values", () => {
  it("reads a bare number as a literal", () => {
    expect(valueOf("350")).toBe(350);
    expect(valueOf("0")).toBe(0);
    expect(valueOf("-120")).toBe(-120);
  });

  it("reads Swedish and typed-in number formats", () => {
    expect(valueOf("1234,50")).toBe(1234.5);
    expect(valueOf("2_000")).toBe(2000);
  });

  it("reads a trailing percent as a fraction", () => {
    // "67%" is how a share is written in the sheet; downstream formulas
    // multiply by it.
    expect(valueOf("67%")).toBe(0.67);
    expect(valueOf("100%")).toBe(1);
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
    expect(valueOf("=350*2")).toBe(700);
    expect(valueOf("=1000-250")).toBe(750);
    expect(valueOf("=900/3")).toBe(300);
  });

  it("applies multiplication before addition", () => {
    expect(valueOf("=2+3*4")).toBe(14);
    expect(valueOf("=(2+3)*4")).toBe(20);
  });

  it("handles a leading minus", () => {
    expect(valueOf("=-5*2")).toBe(-10);
  });

  it("accepts the typographic × and ÷ a spreadsheet paste brings along", () => {
    expect(valueOf("=6×7")).toBe(42);
    expect(valueOf("=84÷2")).toBe(42);
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
    expect(valueOf("=MEDLEMMAR*20", [members])).toBe(3000);
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
    expect(result.accounts.get("SEX01:5010")).toBe(350);
    expect(result.accounts.get("KM01:5010")).toBe(40);
  });

  it("lets a formula read another sheet's account total", () => {
    // account(CC, KONTO) is what makes a rambudget row follow the sheet it
    // summarises instead of being retyped.
    const result = evaluate([], [
      line("300", "a", "SEX01:5010"),
      line("200", "b", "SEX01:5010"),
      line("=account(SEX01, 5010)", "summary", "RAM:5010"),
    ]);
    expect(result.lineItems.get("summary")).toBe(500);
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
    expect(result.lineItems.get("ref")).toBe(400);
    expect(result.lineItems.get("hyphen")).toBe(60);
    expect(result.badLineItems).toEqual([]);
  });

  it("resolves a cost-centre code that leads with a digit", () => {
    const result = evaluate([], [
      line("250", "a", "100:3010"),
      line("=account(100, 3010)", "ref", "SEX01:5010"),
    ]);
    expect(result.lineItems.get("ref")).toBe(250);
    expect(result.badLineItems).toEqual([]);
  });

  it("resolves a variable named with Å/Ä/Ö", () => {
    // Variable names are never validated — only uppercased — so this is
    // reachable, and half-lexing one resolved it to a different, missing name.
    expect(valueOf("=ÅRSAVGIFT*2", [{ name: "ÅRSAVGIFT", expression: "150" }])).toBe(300);
  });

  it("resolves a chain from an account through a variable into a row", () => {
    const result = evaluate(
      [{ name: "SEXTOTAL", expression: "=account(SEX01, 5010)" }],
      [line("1000", "a", "SEX01:5010"), line("=SEXTOTAL*0.5", "half", "KM01:5010")],
    );
    expect(result.lineItems.get("half")).toBe(500);
  });
});

describe("editorial adjustments", () => {
  it("adds a decided change on top of the rows", () => {
    const result = evaluate([], [line("1000")], [], [{ accountKey: "SEX01:5010", amount: 250 }]);
    expect(result.accounts.get("SEX01:5010")).toBe(1250);
  });

  it("creates the total for an account the sheet never budgeted", () => {
    // A förflyttning may fund a post that has no rows at all.
    const result = evaluate([], [], [], [{ accountKey: "SEX01:6000", amount: 500 }]);
    expect(result.accounts.get("SEX01:6000")).toBe(500);
  });

  it("is visible to formulas that read the account", () => {
    // The point of folding adjustments in before evaluation: a reference reads
    // the figure in force, not the one originally adopted.
    const result = evaluate(
      [],
      [line("1000", "a", "SEX01:5010"), line("=account(SEX01, 5010)", "ref", "RAM:5010")],
      [],
      [{ accountKey: "SEX01:5010", amount: 250 }],
    );
    expect(result.lineItems.get("ref")).toBe(1250);
  });
});

describe("references between cells", () => {
  it("reads another row's amount", () => {
    const result = evaluate([], [line("400", "source"), { ...line("=@Lsource:expression*2", "double") }]);
    expect(result.lineItems.get("double")).toBe(800);
  });

  it("reads a per-line value from a user-defined column", () => {
    const rows: LineItemInput[] = [
      { id: "row", accountKey: "SEX01:5010", expression: "=@Lrow:x1*10", values: { x1: "25" } },
    ];
    expect(evaluate([], rows, ["x1"]).lineItems.get("row")).toBe(250);
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
