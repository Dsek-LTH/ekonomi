import { NextResponse } from "next/server";
import { appendInOrder, nextSortOrder } from "@/lib/server/sort-order";
import { denyBudgetWrite } from "@/lib/budget/access";
import { parseBody } from "@/lib/api/parse";
import { CreateVariable } from "@/lib/api/schemas/budget";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const denied = await denyBudgetWrite({ budget: budgetId });
  if (denied) return denied;

  const parsed = await parseBody(req, CreateVariable);
  if (!parsed.ok) return parsed.res;
  const { name, expression } = parsed.data;

  const variable = await appendInOrder({ model: "budget", id: budgetId }, async (tx) => {
    const last = await tx.budgetVariable.findFirst({ where: { budgetId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    return tx.budgetVariable.create({
      data: { budgetId, name, expression, sortOrder: nextSortOrder(last) },
    });
  });
  return NextResponse.json(variable, { status: 201 });
}
