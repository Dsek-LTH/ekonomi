import { describe, expect, it } from "vitest";

import {
  withLine,
  withLineOrder,
  withNewAccount,
  withoutAccount,
  withoutLine,
} from "./patch-budget";
import type { Account, Budget, LineItem } from "./budget-types";

// These stand in for what a write says it did, so the screen doesn't have to go
// and read the whole budget back to find out. The one worth holding to its
// route is `withLineOrder`: the reorder endpoint moves a row between accounts
// as well as within one, and if the two disagree the sheet shows an arrangement
// the database doesn't have, until the next reload silently corrects it, which
// is the worst way to find out.

const line = (id: string): LineItem => ({
  id,
  description: id,
  expression: "0",
  sortOrder: 0,
  values: {},
  // The "antal × á-pris" form, unused by every function under test: these move
  // rows about and never look inside one.
  quantity: null,
  unitPrice: null,
});

const account = (id: string, lineIds: string[]): Account => ({
  id,
  accountCode: id,
  accountName: id,
  lineItems: lineIds.map(line),
  comments: [],
});

/** A budget of one sheet, holding the accounts given. Only the parts these
 *  functions touch are filled in, the rest is not theirs to know about. */
const budgetOf = (...accounts: Account[]): Budget =>
  ({ costCenters: [{ id: "sheet", accounts }] }) as unknown as Budget;

const idsOf = (b: Budget, accountId: string) =>
  b.costCenters[0].accounts.find((a) => a.id === accountId)?.lineItems.map((l) => l.id);

describe("withLineOrder", () => {
  it("puts an account's own rows in the order given", () => {
    const b = withLineOrder(budgetOf(account("A", ["1", "2", "3"])), "A", ["3", "1", "2"]);
    expect(idsOf(b, "A")).toEqual(["3", "1", "2"]);
  });

  it("moves a row named by another account onto it", () => {
    const b = withLineOrder(
      budgetOf(account("A", ["1", "2"]), account("B", ["3"])),
      "B",
      ["3", "1"],
    );
    expect(idsOf(b, "B")).toEqual(["3", "1"]);
    // And the account it left keeps the order it had, minus the row.
    expect(idsOf(b, "A")).toEqual(["2"]);
  });

  it("drops an id the budget has never heard of", () => {
    const b = withLineOrder(budgetOf(account("A", ["1", "2"])), "A", ["2", "gone", "1"]);
    expect(idsOf(b, "A")).toEqual(["2", "1"]);
  });

  it("leaves accounts the order does not name alone", () => {
    const b = withLineOrder(
      budgetOf(account("A", ["1"]), account("B", ["2", "3"])),
      "A",
      ["1"],
    );
    expect(idsOf(b, "B")).toEqual(["2", "3"]);
  });
});

describe("the rest", () => {
  it("appends a created row to its account", () => {
    const b = withLine(budgetOf(account("A", ["1"])), "A", line("2"));
    expect(idsOf(b, "A")).toEqual(["1", "2"]);
  });

  it("removes a row wherever it is", () => {
    const b = withoutLine(budgetOf(account("A", ["1"]), account("B", ["2", "3"])), "3");
    expect(idsOf(b, "B")).toEqual(["2"]);
  });

  it("puts a created account in its sheet, and removes one with its rows", () => {
    const added = withNewAccount(budgetOf(account("A", ["1"])), "sheet", account("B", []));
    expect(added.costCenters[0].accounts.map((a) => a.id)).toEqual(["A", "B"]);
    const removed = withoutAccount(added, "A");
    expect(removed.costCenters[0].accounts.map((a) => a.id)).toEqual(["B"]);
  });

  it("places a created account by its number rather than at the end", () => {
    // The sheet is ordered by account code on the server, so an account added
    // in the middle of the chart has to land in the middle here too. Appending
    // it left 3010 sitting under 5800 until a reload moved it, which reads as
    // the app changing its mind about where the row goes.
    const sheet = budgetOf(account("3010", []), account("5800", []));
    const added = withNewAccount(sheet, "sheet", account("4010", []));
    expect(added.costCenters[0].accounts.map((a) => a.accountCode)).toEqual([
      "3010",
      "4010",
      "5800",
    ]);
  });
});
