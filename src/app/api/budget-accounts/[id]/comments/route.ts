import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canCommentBudget } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const g = await gate(canCommentBudget);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const body_ = typeof body.body === "string" ? body.body.trim() : "";
  if (!body_) return fail(422, "budget.commentEmpty");

  // Comments deliberately don't go through `denyBudgetWrite` — they stay open on
  // a locked budget — but that is also the guard every other budget route gets
  // its existence check from. Without it an account id that isn't there becomes
  // a foreign-key error and a 500 instead of a 404.
  const account = await prisma.budgetAccount.findUnique({
    where: { id: accountId },
    select: { id: true },
  });
  if (!account) return fail(404, "budgetAccount.notFound");

  const comment = await prisma.budgetComment.create({
    data: { accountId, authorId: g.actor.id, body: body_ },
    include: { author: { select: { id: true, name: true } } },
  });
  return NextResponse.json(comment, { status: 201 });
}
