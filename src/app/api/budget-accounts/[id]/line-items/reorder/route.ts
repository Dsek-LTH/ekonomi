import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { ReorderLineItems } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

// POST /api/budget-accounts/[id]/line-items/reorder: this account's rows, in this order (admin).
// An id from another account of the same budget is moved onto this one (a drag between accounts).
// Ids outside the budget are dropped, not refused: `allowBudgetWrite` answers for this budget alone.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const g = await allowBudgetWrite({ account: accountId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, ReorderLineItems);
  if (!parsed.ok) return parsed.res;
  const { orderedIds } = parsed.data;
  if (orderedIds.length === 0) return fail(422, "request.orderedIdsRequired");

  // The guard walked this id up to its budget; this covers it having gone since.
  const account = await prisma.budgetAccount.findUnique({
    where: { id: accountId },
    select: { budgetCostCenter: { select: { budgetId: true } } },
  });
  if (!account) return fail(404, "notFound");

  const rows = await prisma.budgetLineItem.findMany({
    where: {
      id: { in: orderedIds },
      account: { budgetCostCenter: { budgetId: account.budgetCostCenter.budgetId } },
    },
    select: { id: true, accountId: true },
  });
  const from = new Map(rows.map((r) => [r.id, r.accountId]));
  const ids = orderedIds.filter((id) => from.has(id));

  await prisma.$transaction(
    ids.map((id, i) =>
      prisma.budgetLineItem.update({
        where: { id },
        data: from.get(id) === accountId ? { sortOrder: i } : { sortOrder: i, accountId },
      }),
    ),
  );
  return new Response(null, { status: 204 });
}
