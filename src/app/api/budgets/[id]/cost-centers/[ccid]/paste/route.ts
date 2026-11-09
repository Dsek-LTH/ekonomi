import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { Prisma } from "@/lib/generated/prisma/client";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PasteIntoSheet } from "@/lib/api/schemas/budget";
import { rebindCopiedRefs } from "@/lib/budget/paste";

// Copies by ids, reading the originals. Everything must live in this budget: the guard answers for this one only.
// One transaction: insert, then rewrite references to the copies (see lib/budget/paste.ts).
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

  if (accountId) {
    const target = await prisma.budgetAccount.findUnique({
      where: { id: accountId },
      select: { budgetCostCenterId: true },
    });
    if (!target || target.budgetCostCenterId !== ccId) return fail(404, "budgetAccount.notFound");
  }

  await prisma.$transaction(async (tx) => {
    // Locks the sheet so concurrent pastes do not number accounts the same.
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
    const made: { id: string; from: SourceRow }[] = [];

    async function appendRows(into: string, source: SourceRow[]) {
      if (source.length === 0) return;
      const last = await tx.budgetLineItem.findFirst({
        where: { accountId: into },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      let order = nextSortOrder(last);
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
      // createManyAndReturn answers in input order, which pairs each new row with its source.
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
      const existing = await tx.budgetAccount.findFirst({
        where: { budgetCostCenterId: ccId, accountCode: source.accountCode },
        select: { id: true },
      });
      let into = existing?.id;
      if (!into) {
        const made = await tx.budgetAccount.create({
          data: {
            budgetCostCenterId: ccId,
            accountCode: source.accountCode,
            accountName: source.accountName,
          },
          select: { id: true },
        });
        into = made.id;
      } else {
        await lockForAppend(tx, "budgetAccount", into);
      }
      await appendRows(into, source.lineItems);
    }

    // Rebind equations that pointed at another copied row to that row's copy; outside references stay.
    // Rebound from the source row, writing only the rows that changed.
    for (const row of made) {
      const bound = rebindCopiedRefs(row.from, copied);
      if (bound) await tx.budgetLineItem.update({ where: { id: row.id }, data: bound });
    }
  });

  const updated = await prisma.budgetCostCenter.findUnique({
    where: { id: ccId },
    include: {
      costCenter: true,
      accounts: {
        // Same order as lib/data/budget.ts.
        orderBy: { accountCode: "asc" },
        include: {
          lineItems: { orderBy: { sortOrder: "asc" } },
          comments: {
            orderBy: { createdAt: "asc" },
            include: { author: { select: { name: true, id: true } } },
          },
        },
      },
    },
  });
  return NextResponse.json(updated, { status: 201 });
}
