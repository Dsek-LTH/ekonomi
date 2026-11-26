import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { PatchCells } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { lockForAppend, nextSortOrder } from "@/lib/server/sort-order";

// POST /api/budgets/[id]/cells: a block paste on a sheet in one write. The Beskrivning and
// Belopp of existing lines, and new lines at the end of an account for values that ran past
// its last line. One transaction, so a paste lands whole or not at all. Every line and account
// must be this budget's: `allowBudgetWrite` answers for this budget alone.
// Answers with the lines made, in the order asked for.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const g = await allowBudgetWrite({ budget: budgetId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchCells);
  if (!parsed.ok) return parsed.res;
  const { lines, create } = parsed.data;

  const inBudget = { budgetCostCenter: { budgetId } };
  const lineIds = [...new Set(lines.map((l) => l.id))];
  const accountIds = [...new Set(create.map((c) => c.accountId))];
  const [foundLines, foundAccounts] = await Promise.all([
    prisma.budgetLineItem.count({ where: { id: { in: lineIds }, account: inBudget } }),
    prisma.budgetAccount.count({ where: { id: { in: accountIds }, ...inBudget } }),
  ]);
  if (foundLines !== lineIds.length || foundAccounts !== accountIds.length) {
    return fail(404, "notFound");
  }

  const created = await prisma.$transaction(async (tx) => {
    for (const l of lines) {
      await tx.budgetLineItem.update({
        where: { id: l.id },
        data: {
          ...(l.description !== undefined && { description: l.description }),
          ...(l.expression !== undefined && { expression: l.expression }),
        },
      });
    }
    // Appended in order, each account's list locked first (lib/server/sort-order.ts).
    const next = new Map<string, number>();
    for (const accountId of accountIds) {
      await lockForAppend(tx, "budgetAccount", accountId);
      const last = await tx.budgetLineItem.findFirst({
        where: { accountId },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      next.set(accountId, nextSortOrder(last));
    }
    const made = [];
    for (const c of create) {
      const sortOrder = next.get(c.accountId)!;
      next.set(c.accountId, sortOrder + 1);
      made.push(
        await tx.budgetLineItem.create({
          data: {
            accountId: c.accountId,
            description: c.description,
            // A row with no equation is a zero, as a line made in the sheet is.
            expression: c.expression || "0",
            sortOrder,
          },
        }),
      );
    }
    return made;
  });
  return NextResponse.json({ created }, { status: 200 });
}
