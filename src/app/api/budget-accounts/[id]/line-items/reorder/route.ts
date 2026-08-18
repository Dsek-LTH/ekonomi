import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { ReorderLineItems } from "@/lib/api/schemas/budget";
import { denyBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

// POST /api/budget-accounts/[id]/line-items/reorder — this account's rows, in
// this order (admin).
//
// An id that belongs to another account of the same budget is moved onto this
// one, because that is what dragging a row from one account to another in a
// sheet is: a row lands in a place, and the place is an account and a position
// in it at once. Whichever account a row leaves keeps the order it had — the
// rows still in it are untouched, and a gap in their numbering means nothing.
//
// Anything outside the budget is dropped rather than refused: `denyBudgetWrite`
// answers for this budget alone, so an id from another one is an id this
// request was never entitled to move.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const denied = await denyBudgetWrite({ account: accountId });
  if (denied) return denied;

  const parsed = await parseBody(req, ReorderLineItems);
  if (!parsed.ok) return parsed.res;
  const { orderedIds } = parsed.data;
  if (orderedIds.length === 0) return fail(422, "request.orderedIdsRequired");

  // The guard above walked this id up to its budget, so it was there a moment
  // ago; this covers it having gone since, and names the budget to stay inside.
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
