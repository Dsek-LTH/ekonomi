import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const denied = await denyBudgetWrite({ account: accountId });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const expression = typeof body.expression === "string" ? body.expression.trim() : "0";
  if (!description && !expression) {
    return fail(422, "budget.lineRequired");
  }

  const last = await prisma.budgetLineItem.findFirst({ where: { accountId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const item = await prisma.budgetLineItem.create({
    data: { accountId, description, expression, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(item, { status: 201 });
}
