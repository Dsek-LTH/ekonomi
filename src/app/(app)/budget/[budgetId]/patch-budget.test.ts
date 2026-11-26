import { describe, expect, it } from "vitest";

import {
  withAccountCode,
  withComment,
  withoutComment,
  withLine,
  withLineOrder,
  withNewAccount,
  withoutAccount,
  withoutLine,
} from "./patch-budget";
import type { Account, Budget, Comment, LineItem } from "./budget-types";

// Stand-ins for what a write says it did. `withLineOrder` must match the reorder endpoint
// (which also moves rows between accounts), or the sheet shows an arrangement the database
// lacks until reload.

const line = (id: string): LineItem => ({
  id,
  description: id,
  expression: "0",
  sortOrder: 0,
  values: {},

  quantity: null,
  unitPrice: null,
  comments: [],
});

const account = (id: string, lineIds: string[]): Account => ({
  id,
  accountCode: id,
  accountName: id,
  lineItems: lineIds.map(line),
  comments: [],
});

/** A one-sheet budget holding the accounts given; only the parts these functions touch are filled in. */
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
    const b = withLineOrder(budgetOf(account("A", ["1", "2"]), account("B", ["3"])), "B", [
      "3",
      "1",
    ]);
    expect(idsOf(b, "B")).toEqual(["3", "1"]);
    expect(idsOf(b, "A")).toEqual(["2"]);
  });

  it("drops an id the budget has never heard of", () => {
    const b = withLineOrder(budgetOf(account("A", ["1", "2"])), "A", ["2", "gone", "1"]);
    expect(idsOf(b, "A")).toEqual(["2", "1"]);
  });

  it("leaves accounts the order does not name alone", () => {
    const b = withLineOrder(budgetOf(account("A", ["1"]), account("B", ["2", "3"])), "A", ["1"]);
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
    // The sheet is ordered by account code on the server, so a mid-chart account lands mid-chart.
    const sheet = budgetOf(account("3010", []), account("5800", []));
    const added = withNewAccount(sheet, "sheet", account("4010", []));
    expect(added.costCenters[0].accounts.map((a) => a.accountCode)).toEqual([
      "3010",
      "4010",
      "5800",
    ]);
  });

  it("moves an account to its new place when its number changes", () => {
    const sheet = budgetOf(account("4010", []), account("5410", []), account("5800", []));
    const changed = withAccountCode(sheet, "4010", "6110", "Kontorsmaterial");
    expect(changed.costCenters[0].accounts.map((a) => a.accountCode)).toEqual([
      "5410",
      "5800",
      "6110",
    ]);
    expect(changed.costCenters[0].accounts[2]).toMatchObject({
      id: "4010",
      accountName: "Kontorsmaterial",
    });
  });
});

describe("comments", () => {
  const comment = (id: string, field: Comment["field"] = null): Comment => ({
    id,
    body: id,
    createdAt: "2026-11-26T12:00:00.000Z",
    author: { id: "u", name: "U" },
    field,
  });
  const lineComments = (b: Budget, lineId: string) =>
    b.costCenters[0].accounts.flatMap((a) => a.lineItems).find((l) => l.id === lineId)?.comments;

  it("puts a cell's comment on its line, keeping the cell it names", () => {
    const b = withComment(
      budgetOf(account("A", ["1", "2"])),
      { lineId: "2" },
      comment("c", "expression"),
    );
    expect(lineComments(b, "2")).toEqual([comment("c", "expression")]);
    expect(lineComments(b, "1")).toEqual([]);
    expect(b.costCenters[0].accounts[0].comments).toEqual([]);
  });

  it("puts an account's comment on the account", () => {
    const b = withComment(budgetOf(account("A", ["1"])), { accountId: "A" }, comment("c"));
    expect(b.costCenters[0].accounts[0].comments).toEqual([comment("c")]);
    expect(lineComments(b, "1")).toEqual([]);
  });

  it("takes a comment off wherever it was", () => {
    let b = withComment(
      budgetOf(account("A", ["1"])),
      { lineId: "1" },
      comment("on-line", "description"),
    );
    b = withComment(b, { accountId: "A" }, comment("on-account"));
    b = withoutComment(withoutComment(b, "on-line"), "on-account");
    expect(lineComments(b, "1")).toEqual([]);
    expect(b.costCenters[0].accounts[0].comments).toEqual([]);
  });
});
