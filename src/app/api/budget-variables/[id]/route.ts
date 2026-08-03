import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ variable: id });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim().toUpperCase();
  if (typeof body.expression === "string") data.expression = body.expression.trim();
  if (typeof body.sortOrder === "number") data.sortOrder = body.sortOrder;

  const variable = await prisma.budgetVariable.update({ where: { id }, data });
  return NextResponse.json(variable);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ variable: id });
  if (denied) return denied;
  await prisma.budgetVariable.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
