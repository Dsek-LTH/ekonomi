import { describe, expect, it } from "vitest";
import { buildGrid, orderedColumns, toDisplay, toStored, type GridSheet } from "./grid";

const columns = orderedColumns();

// SEX02: an income account (1 section, 2 account 3010, 3 line li1), then a cost account (4 section, 5 account 4010, 6-7 lines).
// KM01 has no income, but both section rows are still emitted: 1 section (income), 2 section (cost), 3 account 4010, 4 line li9.
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
    accounts: [{ id: "b1", accountCode: "4010", lineItems: [{ id: "li9" }] }],
  },
];

const grid = buildGrid(sheets, columns);

describe("orderedColumns", () => {
  it("lays out Konto, Beskrivning, Belopp in that order", () => {
    expect(columns.map((c) => c.key)).toEqual(["konto", "beskrivning", "expression"]);
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
    expect(toStored("=#6", "SEX02", grid)).toBe("=@Lli2:expression");
  });

  it("binds a reference to an account as the account itself", () => {
    expect(toStored("=#5", "SEX02", grid)).toBe("=account(SEX02, 4010)");
  });

  it("carries the sheet across when one is named", () => {
    expect(toStored("=KM01#4", "SEX02", grid)).toBe("=@Lli9:expression");
  });

  it("rewrites every reference in an expression", () => {
    expect(toStored("=#6+#7", "SEX02", grid)).toBe(
      "=@Lli2:expression+@Lli3:expression",
    );
  });

  it("leaves variables and numbers in an expression untouched", () => {
    expect(toStored("=2*TROJA_POLICY", "SEX02", grid)).toBe("=2*TROJA_POLICY");
  });

  // A reference naming no real row is left as typed.
  it("leaves a reference that resolves to nothing alone", () => {
    expect(toStored("=#99", "SEX02", grid)).toBe("=#99");
    expect(toStored("=NOPE#3", "SEX02", grid)).toBe("=NOPE#3");
  });

  // A section row has a number but no figure.
  it("refuses to bind a reference to a section row", () => {
    expect(toStored("=#1", "SEX02", grid)).toBe("=#1");
  });

  // The A1 form from before row references is not read: C6 is a variable name like any other.
  it("does not read the old A1 form", () => {
    expect(toStored("=C6", "SEX02", grid)).toBe("=C6");
    expect(toStored("=KM01!C4", "SEX02", grid)).toBe("=KM01!C4");
  });

  it("reads a reference next to an operator", () => {
    expect(toStored("=2*#6-#7", "SEX02", grid)).toBe("=2*@Lli2:expression-@Lli3:expression");
  });
});

describe("toDisplay: what is kept → what is shown while editing", () => {
  it("leaves a literal alone", () => {
    expect(toDisplay("1200", "SEX02", grid)).toBe("1200");
  });

  it("shows a row reference at the row's current coordinates", () => {
    expect(toDisplay("=@Lli2:expression", "SEX02", grid)).toBe("=#6");
  });

  it("shows an account reference at the account's row", () => {
    expect(toDisplay("=account(SEX02, 4010)", "SEX02", grid)).toBe("=#5");
  });

  it("names the sheet only when it is a different one", () => {
    expect(toDisplay("=@Lli9:expression", "SEX02", grid)).toBe("=KM01#4");
    expect(toDisplay("=@Lli9:expression", "KM01", grid)).toBe("=#4");
  });

  it("leaves a token pointing at a row that no longer exists alone", () => {
    expect(toDisplay("=@Lgone:expression", "SEX02", grid)).toBe("=@Lgone:expression");
    expect(toDisplay("=account(SEX02, 9999)", "SEX02", grid)).toBe("=account(SEX02, 9999)");
  });

  it("still reads the legacy single-letter field suffix", () => {
    expect(toDisplay("=@Lli2:E", "SEX02", grid)).toBe("=#6");
  });
});

describe("round trip", () => {
  // Opening a formula for editing and closing it unchanged must not change what is stored.
  it.each([
    "=#6",
    "=#6+#7",
    "=#5*2",
    "=KM01#4",
    "=2*TROJA_POLICY",
    "1200",
  ])("%s survives reference → token → reference", (typed) => {
    const stored = toStored(typed, "SEX02", grid);
    expect(toDisplay(stored, "SEX02", grid)).toBe(typed);
  });

  // A row that moves keeps its meaning: the formula follows it to its new coordinates.
  it("follows a row that has moved", () => {
    const stored = toStored("=#6", "SEX02", grid); // li2, currently row 6
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
    expect(toDisplay(stored, "SEX02", moved)).toBe("=#7");
  });
});
