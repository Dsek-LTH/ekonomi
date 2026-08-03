import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const denied = await denyBudgetWrite({ budget: budgetId });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().toUpperCase() : "";
  const expression = typeof body.expression === "string" ? body.expression.trim() : "0";
  if (!name) return fail(422, "resultUnit.nameRequired");

  const last = await prisma.budgetVariable.findFirst({ where: { budgetId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const variable = await prisma.budgetVariable.create({
    data: { budgetId, name, expression, sortOrder: (last?.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(variable, { status: 201 });
}
