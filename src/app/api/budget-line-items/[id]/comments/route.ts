import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { BudgetLineCommentBody } from "@/lib/api/schemas/budget";
import { canCommentBudget } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { announceBudgetChange } from "@/lib/server/budget-live";

/** A comment on one of a line's cells (`field`: Beskrivning or Belopp). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: lineItemId } = await ctx.params;
  const g = await gate(canCommentBudget);
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, BudgetLineCommentBody);
  if (!parsed.ok) return parsed.res;
  const { body, field } = parsed.data;

  // Open on a locked budget too, like account comments (budget-accounts/[id]/comments).
  const line = await prisma.budgetLineItem.findUnique({
    where: { id: lineItemId },
    select: { account: { select: { budgetCostCenter: { select: { budgetId: true } } } } },
  });
  if (!line) return fail(404, "notFound");
  announceBudgetChange(line.account.budgetCostCenter.budgetId);

  const comment = await prisma.budgetComment.create({
    data: { lineItemId, field, authorId: g.actor.id, body },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json(comment, { status: 201 });
}
