import { prisma } from "@/lib/server/db";
import { parseBody } from "@/lib/api/parse";
import { DeleteLines } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

// POST /api/budgets/[id]/lines/delete: the lines chosen on a sheet removed in one write (Ta bort,
// Delete), so they go together or not at all. Their comments go with them (onDelete: Cascade).
// Every line must be this budget's: `allowBudgetWrite` answers for this budget alone.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const g = await allowBudgetWrite({ budget: budgetId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, DeleteLines);
  if (!parsed.ok) return parsed.res;
  const ids = [...new Set(parsed.data.ids)];

  const where = { id: { in: ids }, account: { budgetCostCenter: { budgetId } } };
  const { count } = await prisma.$transaction(async (tx) => {
    const found = await tx.budgetLineItem.count({ where });
    if (found !== ids.length) return { count: -1 };
    return tx.budgetLineItem.deleteMany({ where });
  });
  if (count < 0) return fail(404, "notFound");
  return new Response(null, { status: 204 });
}
