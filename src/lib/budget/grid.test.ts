import { describe, expect, it } from "vitest";
import { buildGrid, orderedColumns, toDisplay, toStored, type GridSheet } from "./grid";

const columns = orderedColumns();

// The letter of the Belopp column, which is where every formula lives. Read from
// the layout rather than written down, so this doesn't have to be edited if a
// column is ever inserted before it.
const BELOPP = columns.find((c) => c.key === "expression")!.letter;
const KONTO = columns.find((c) => c.key === "konto")!.letter;

// SEX02: an income account with one row, then a cost account with two. Rows are
// numbered from 1 with a section header before each kind:
//   1 section (income) – 2 account 3010 – 3 line li1
//   4 section (cost)   – 5 account 4010 – 6 line li2 – 7 line li3
//
// KM01 has no income at all, and is here for the subtlety that follows from
// that: both section rows are emitted regardless, so a cost-only sheet still
// starts its accounts at row 3 rather than row 2.
//   1 section (income, empty) – 2 section (cost) – 3 account 4010 – 4 line li9
const sheets: GridSheet[] = [
  {
    code: "SEX02",
    accounts: [
      { id: "a1", accountCode: "3010", lineItems: [{ id: "li1" }] },
      { id: "a2", accountCode: "4010", lineItems: [{ id: "li2" }, { id: "li3" }] },
    ],
  },
  {
    code: "KM01",
    accounts: [
      { id: "b1", accountCode: "4010", lineItems: [{ id: "li9" }] },
    ],
  },
];

const grid = buildGrid(sheets, columns);

describe("orderedColumns", () => {
  it("lays out Konto, Beskrivning, Belopp in that order", () => {
    expect(columns.map((c) => c.key)).toEqual(["konto", "beskrivning", "expression"]);
  });

  it("assigns letters by position", () => {
    expect(columns.map((c) => c.letter)).toEqual(["A", "B", "C"]);
  });
});

describe("buildGrid", () => {
  it("numbers income accounts before cost accounts, each under a section row", () => {
    expect(grid.accountRow.get("SEX02|a1")).toBe(2);
    expect(grid.lineRow.get("SEX02|li1")).toBe(3);
    expect(grid.accountRow.get("SEX02|a2")).toBe(5);
    expect(grid.lineRow.get("SEX02|li2")).toBe(6);
    expect(grid.lineRow.get("SEX02|li3")).toBe(7);
  });

  it("numbers each sheet from the top, section rows included", () => {
    // Not 2: the empty income section still takes a row.
    expect(grid.accountRow.get("KM01|b1")).toBe(3);
  });

  it("knows which sheet a row id lives on, for the reverse direction", () => {
    expect(grid.lineLoc.get("li9")).toEqual({ sheet: "KM01", row: 4 });
  });

  // The same account code appears in several sheets; the row is per sheet.
  it("keys account codes by sheet", () => {
    expect(grid.acctCodeRow.get("SEX02|4010")).toBe(5);
    expect(grid.acctCodeRow.get("KM01|4010")).toBe(3);
  });
});

describe("toStored: what was typed → what is kept", () => {
  it("leaves a literal alone", () => {
    expect(toStored("1200", "SEX02", grid)).toBe("1200");
    expect(toStored("", "SEX02", grid)).toBe("");
  });

  it("binds a reference to a row's own id, not to where it sits", () => {
    expect(toStored(`=${BELOPP}6`, "SEX02", grid)).toBe("=@Lli2:expression");
  });

  it("binds a reference to an account as the account itself", () => {
    expect(toStored(`=${BELOPP}5`, "SEX02", grid)).toBe("=account(SEX02, 4010)");
  });

  it("carries the sheet across when one is named", () => {
    expect(toStored(`=KM01!${BELOPP}4`, "SEX02", grid)).toBe("=@Lli9:expression");
  });

  it("rewrites every reference in an expression", () => {
    expect(toStored(`=${BELOPP}6+${BELOPP}7`, "SEX02", grid)).toBe(
      "=@Lli2:expression+@Lli3:expression",
    );
  });

  it("leaves variables and numbers in an expression untouched", () => {
    expect(toStored("=2*TROJA_POLICY", "SEX02", grid)).toBe("=2*TROJA_POLICY");
  });

  // An A1 word that names no real cell is left as typed, so the formula still
  // shows what someone wrote rather than silently losing it.
  it("leaves an A1 word that resolves to nothing alone", () => {
    expect(toStored(`=${BELOPP}99`, "SEX02", grid)).toBe(`=${BELOPP}99`);
    expect(toStored("=Z1", "SEX02", grid)).toBe("=Z1");
  });

  // Only the Belopp column holds a figure; a text column is not referenceable.
  it("refuses to bind a reference to a text column", () => {
    expect(toStored(`=${KONTO}6`, "SEX02", grid)).toBe(`=${KONTO}6`);
  });

  it("is case-insensitive about the column letter", () => {
    expect(toStored(`=${BELOPP.toLowerCase()}6`, "SEX02", grid)).toBe("=@Lli2:expression");
  });
});

describe("toDisplay: what is kept → what is shown while editing", () => {
  it("leaves a literal alone", () => {
    expect(toDisplay("1200", "SEX02", grid)).toBe("1200");
  });

  it("shows a row reference at the row's current coordinates", () => {
    expect(toDisplay("=@Lli2:expression", "SEX02", grid)).toBe(`=${BELOPP}6`);
  });

  it("shows an account reference at the account's row", () => {
    expect(toDisplay("=account(SEX02, 4010)", "SEX02", grid)).toBe(`=${BELOPP}5`);
  });

  it("names the sheet only when it is a different one", () => {
    expect(toDisplay("=@Lli9:expression", "SEX02", grid)).toBe(`=KM01!${BELOPP}4`);
    expect(toDisplay("=@Lli9:expression", "KM01", grid)).toBe(`=${BELOPP}4`);
  });

  it("leaves a token pointing at a row that no longer exists alone", () => {
    expect(toDisplay("=@Lgone:expression", "SEX02", grid)).toBe("=@Lgone:expression");
    expect(toDisplay("=account(SEX02, 9999)", "SEX02", grid)).toBe("=account(SEX02, 9999)");
  });

  // The suffix formulas carried before the columns were named.
  it("still reads the legacy single-letter field suffix", () => {
    expect(toDisplay("=@Lli2:E", "SEX02", grid)).toBe(`=${BELOPP}6`);
  });
});

describe("round trip", () => {
  // The property that matters: opening a formula for editing and closing it
  // again without touching anything must not change what is stored.
  it.each([
    `=${BELOPP}6`,
    `=${BELOPP}6+${BELOPP}7`,
    `=${BELOPP}5*2`,
    `=KM01!${BELOPP}4`,
    "=2*TROJA_POLICY",
    "1200",
  ])("%s survives A1 → token → A1", (typed) => {
    const stored = toStored(typed, "SEX02", grid);
    expect(toDisplay(stored, "SEX02", grid)).toBe(typed);
  });

  // The point of binding to ids: a row that moves keeps its meaning, and the
  // formula follows it to its new coordinates.
  it("follows a row that has moved", () => {
    const stored = toStored(`=${BELOPP}6`, "SEX02", grid); // li2, currently row 6
    // A row is inserted above li2, pushing it down one.
    const moved = buildGrid(
      [
        {
          code: "SEX02",
          accounts: [
            { id: "a1", accountCode: "3010", lineItems: [{ id: "li1" }] },
            {
              id: "a2",
              accountCode: "4010",
              lineItems: [{ id: "li0" }, { id: "li2" }, { id: "li3" }],
            },
          ],
        },
      ],
      columns,
    );
    expect(toDisplay(stored, "SEX02", moved)).toBe(`=${BELOPP}7`);
  });
});
