import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PasteIntoSheet } from "@/lib/api/schemas/budget";
import { rebindCopiedRefs } from "@/lib/budget/paste";

// POST /api/budgets/[id]/cost-centers/[ccid]/paste: copied rows, or copied
// accounts, into this sheet (admin, unlocked).
//
// The copy is named by ids, so this reads the originals and brings everything
// over: the equation, the antal × á-pris pair, the six general columns. A copy
// assembled on the screen would be a second opinion about what a row is.
//
// One request and one transaction, because of the references. A row's equation
// can point at another row by its id, and pasting a block of rows that point at
// each other has to end with the copies pointing at the copies, which is only
// answerable once the copies have ids. So: insert, then rewrite what was
// copied, in the same breath (see lib/budget/paste.ts).
//
// Everything must live in this budget. The guard below answers for this one
// alone, so an id from another budget is one this request was never entitled to
// read, let alone copy.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { id: budgetId, ccid: ccId } = await ctx.params;
  const g = await allowBudgetWrite({ costCenter: ccId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PasteIntoSheet);
  if (!parsed.ok) return parsed.res;
  const { accountId, lineItemIds, accountIds } = parsed.data;
  if (lineItemIds.length === 0 && accountIds.length === 0) {
    return fail(422, "budget.nothingToPaste");
  }
  if (lineItemIds.length > 0 && !accountId) return fail(422, "budget.pasteNeedsAccount");

  const sheet = await prisma.budgetCostCenter.findUnique({
    where: { id: ccId },
    select: { id: true, budgetId: true },
  });
  if (!sheet || sheet.budgetId !== budgetId) return fail(404, "notFound");

  const inThisBudget = { account: { budgetCostCenter: { budgetId } } };

  // The rows being copied, in the order they were named: that is the order they
  // were shown in, and so the order to paste them in.
  const sourceRows = await prisma.budgetLineItem.findMany({
    where: { id: { in: lineItemIds }, ...inThisBudget },
  });
  const rowsById = new Map(sourceRows.map((r) => [r.id, r]));
  const rows = lineItemIds.flatMap((id) => rowsById.get(id) ?? []);

  const sourceAccounts = await prisma.budgetAccount.findMany({
    where: { id: { in: accountIds }, budgetCostCenter: { budgetId } },
    include: { lineItems: { orderBy: { sortOrder: "asc" } } },
  });
  const accountsById = new Map(sourceAccounts.map((a) => [a.id, a]));
  const accounts = accountIds.flatMap((id) => accountsById.get(id) ?? []);

  if (rows.length === 0 && accounts.length === 0) return fail(404, "notFound");

  // The target account has to be one of this sheet's, or rows would be pasted
  // somewhere the sheet on screen isn't showing.
  if (accountId) {
    const target = await prisma.budgetAccount.findUnique({
      where: { id: accountId },
      select: { budgetCostCenterId: true },
    });
    if (!target || target.budgetCostCenterId !== ccId) return fail(404, "budgetAccount.notFound");
  }

  await prisma.$transaction(async (tx) => {
    // The sheet, so two pastes into it queue up rather than numbering their
    // accounts the same; each account is locked as its rows are added.
    await lockForAppend(tx, "budgetCostCenter", ccId);

    type SourceRow = {
      id: string;
      description: string;
      expression: string;
      quantity: string | null;
      unitPrice: string | null;
      values: Prisma.JsonValue;
    };

    /** Copied row id → the row it became, for the reference rewrite at the end. */
    const copied = new Map<string, string>();
    /** The new rows, each still holding what it was copied from. */
    const made: { id: string; from: SourceRow }[] = [];

    async function appendRows(into: string, source: SourceRow[]) {
      if (source.length === 0) return;
      const last = await tx.budgetLineItem.findFirst({
        where: { accountId: into },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      let order = nextSortOrder(last);
      // One statement for the whole account rather than one per row. A sheet of
      // two hundred rows was two hundred round trips inside a transaction that
      // every other paste into this budget is queued behind.
      const created = await tx.budgetLineItem.createManyAndReturn({
        data: source.map((row) => ({
          accountId: into,
          description: row.description,
          expression: row.expression,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
          values: row.values ?? {},
          sortOrder: order++,
        })),
        select: { id: true },
      });
      // `createManyAndReturn` answers in the order it was given, which is what
      // pairs each new row with the one it came from.
      created.forEach((row, i) => {
        copied.set(source[i].id, row.id);
        made.push({ id: row.id, from: source[i] });
      });
    }

    if (accountId && rows.length > 0) {
      await lockForAppend(tx, "budgetAccount", accountId);
      await appendRows(accountId, rows);
    }

    for (const source of accounts) {
      // An account this sheet already budgets for takes the rows; the account
      // code is what identifies it, and one sheet never holds it twice.
      const existing = await tx.budgetAccount.findFirst({
        where: { budgetCostCenterId: ccId, accountCode: source.accountCode },
        select: { id: true },
      });
      let into = existing?.id;
      if (!into) {
        const last = await tx.budgetAccount.findFirst({
          where: { budgetCostCenterId: ccId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        const made = await tx.budgetAccount.create({
          data: {
            budgetCostCenterId: ccId,
            accountCode: source.accountCode,
            accountName: source.accountName,
            // Carried over: an account put on the income side by hand is there
            // for a reason, and it is not one its code can be asked about.
            kindOverride: source.kindOverride,
            sortOrder: nextSortOrder(last),
          },
          select: { id: true },
        });
        into = made.id;
      } else {
        await lockForAppend(tx, "budgetAccount", into);
      }
      await appendRows(into, source.lineItems);
    }

    // Now that the copies have ids: a copy whose equation pointed at another
    // row of the same copy is pointed at that row's copy instead. Anything it
    // pointed at from outside (another sheet, an account total, a variable)
    // is left exactly where it was aimed.
    //
    // Rebound from the source row rather than by reading each copy back. The
    // copy is a duplicate of its source, formulas included, so the two have the
    // same references and the round trip per row was asking the database to
    // repeat something already in hand. Only the rows that actually changed are
    // written.
    for (const row of made) {
      const bound = rebindCopiedRefs(row.from, copied);
      if (bound) await tx.budgetLineItem.update({ where: { id: row.id }, data: bound });
    }
  });

  // The sheet as it now stands, so the screen can put this one straight in
  // rather than reading the whole budget back for it.
  const updated = await prisma.budgetCostCenter.findUnique({
    where: { id: ccId },
    include: {
      costCenter: true,
      accounts: {
        orderBy: { sortOrder: "asc" },
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          comments: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true, id: true } } } },
        },
      },
    },
  });
  return NextResponse.json(updated, { status: 201 });
}
