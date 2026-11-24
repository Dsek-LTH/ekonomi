import { prisma } from "@/lib/server/db";
import { isAdmin } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { announceBudgetChange } from "@/lib/server/budget-live";

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const comment = await prisma.budgetComment.findUnique({
    where: { id },
    select: {
      authorId: true,
      account: { select: { budgetCostCenter: { select: { budgetId: true } } } },
    },
  });
  if (!comment) return fail(404, "budget.commentNotFound");

  // Your own comment, or an admin clearing up someone else's.
  if (comment.authorId !== g.actor.id && !isAdmin(g.actor.capabilities)) {
    return fail(403, "auth.denied");
  }

  await prisma.budgetComment.delete({ where: { id } });
  announceBudgetChange(comment.account.budgetCostCenter.budgetId);
  return new Response(null, { status: 204 });
}
