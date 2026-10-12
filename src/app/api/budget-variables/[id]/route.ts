import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { PatchVariable } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await allowBudgetWrite({ variable: id });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchVariable);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.expression !== undefined) data.expression = body.expression;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  const variable = await prisma.budgetVariable.update({ where: { id }, data });
  return NextResponse.json(variable);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await allowBudgetWrite({ variable: id });
  if (!g.ok) return g.res;
  await prisma.budgetVariable.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
