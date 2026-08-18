import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";
import { denyBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PasteIntoSheet } from "@/lib/api/schemas/budget";
import { rebindCopiedRefs } from "@/lib/budget/paste";

// POST /api/budgets/[id]/cost-centers/[ccid]/paste — copied rows, or copied
// accounts, into this sheet (admin, unlocked).
//
// The copy is named by ids, so this reads the originals and brings everything
// over: the equation, the antal × á-pris pair, the six general columns. A copy
// assembled on the screen would be a second opinion about what a row is.
//
// One request and one transaction, because of the references. A row's equation
// can point at another row by its id, and pasting a block of rows that point at
// each other has to end with the copies pointing at the copies — which is only
// answerable once the copies have ids. So: insert, then rewrite what was
// copied, in the same breath (see lib/budget/paste.ts).
//
// Everything must live in this budget. The guard below answers for this one
// alone, so an id from another budget is one this request was never entitled to
// read, let alone copy.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; ccid: string }> }) {
  const { id: budgetId, ccid: ccId } = await ctx.params;
  const denied = await denyBudgetWrite({ costCenter: ccId });
  if (denied) return denied;

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

    /** Copied row id → the row it became, for the reference rewrite at the end. */
    const copied = new Map<string, string>();

    async function appendRows(
      into: string,
      source: { id: string; description: string; expression: string; quantity: string | null; unitPrice: string | null; values: Prisma.JsonValue }[],
    ) {
      const last = await tx.budgetLineItem.findFirst({
        where: { accountId: into },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      let order = nextSortOrder(last);
      for (const row of source) {
        const made = await tx.budgetLineItem.create({
          data: {
            accountId: into,
            description: row.description,
            expression: row.expression,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            values: row.values ?? {},
            sortOrder: order++,
          },
          select: { id: true },
        });
        copied.set(row.id, made.id);
      }
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
    // pointed at from outside — another sheet, an account total, a variable —
    // is left exactly where it was aimed.
    for (const to of copied.values()) {
      const row = await tx.budgetLineItem.findUnique({
        where: { id: to },
        select: { expression: true, quantity: true, unitPrice: true, values: true },
      });
      if (!row) continue;
      const bound = rebindCopiedRefs(row, copied);
      if (bound) await tx.budgetLineItem.update({ where: { id: to }, data: bound });
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
