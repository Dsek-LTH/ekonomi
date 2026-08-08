import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { ReorderLineItems } from "@/lib/api/schemas/budget";
import { denyBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

// POST /api/budget-accounts/[id]/line-items/reorder — reassign sortOrder to the
// given order (admin). Ignores ids that don't belong to this account.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const denied = await denyBudgetWrite({ account: accountId });
  if (denied) return denied;

  const parsed = await parseBody(req, ReorderLineItems);
  if (!parsed.ok) return parsed.res;
  const { orderedIds } = parsed.data;
  if (orderedIds.length === 0) return fail(422, "request.orderedIdsRequired");

  const own = await prisma.budgetLineItem.findMany({ where: { accountId }, select: { id: true } });
  const valid = new Set(own.map((o) => o.id));
  const ids = orderedIds.filter((id) => valid.has(id));

  await prisma.$transaction(ids.map((id, i) => prisma.budgetLineItem.update({ where: { id }, data: { sortOrder: i } })));
  return new Response(null, { status: 204 });
}
