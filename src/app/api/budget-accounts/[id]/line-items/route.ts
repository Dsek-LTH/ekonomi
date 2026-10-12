import { NextResponse } from "next/server";
import { appendInOrder, nextSortOrder } from "@/lib/server/sort-order";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateLineItem } from "@/lib/api/schemas/budget";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: accountId } = await ctx.params;
  const g = await allowBudgetWrite({ account: accountId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateLineItem);
  if (!parsed.ok) return parsed.res;
  const { description, expression } = parsed.data;
  if (!description && !expression) {
    return fail(422, "budget.lineRequired");
  }

  const item = await appendInOrder({ model: "budgetAccount", id: accountId }, async (tx) => {
    const last = await tx.budgetLineItem.findFirst({ where: { accountId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
    return tx.budgetLineItem.create({
      data: { accountId, description, expression, sortOrder: nextSortOrder(last) },
    });
  });
  return NextResponse.json(item, { status: 201 });
}
