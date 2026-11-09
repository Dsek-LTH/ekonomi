import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { appendInOrder, nextSortOrder } from "@/lib/server/sort-order";
import { allowBudgetWrite } from "@/lib/budget/access";
import { cloneCostCenter } from "@/lib/budget/clone";
import { bulkTransaction } from "@/lib/server/tx";
import { fail } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateSheet } from "@/lib/api/schemas/budget";

// Body is { costCenterId } or { cloneFromId } (a detached copy of a sheet already in this budget).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const g = await allowBudgetWrite({ budget: budgetId });
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateSheet);
  if (!parsed.ok) return parsed.res;
  const cloneFromId = parsed.data.cloneFromId ?? null;

  if (cloneFromId) {
    const source = await prisma.budgetCostCenter.findUnique({
      where: { id: cloneFromId },
      select: { budgetId: true },
    });
    // Cloning out of another budget would sidestep that budget's own lock.
    if (!source || source.budgetId !== budgetId) {
      return fail(404, "budget.sheetNotFound");
    }
    const cloneId = await bulkTransaction((tx) => cloneCostCenter(tx, cloneFromId));
    const clone = await prisma.budgetCostCenter.findUnique({ where: { id: cloneId! } });
    return NextResponse.json(clone, { status: 201 });
  }

  const costCenterId = parsed.data.costCenterId ?? null;
  if (!costCenterId) return fail(422, "request.costCenterIdRequired");

  const cc = await appendInOrder({ model: "budget", id: budgetId }, async (tx) => {
    const last = await tx.budgetCostCenter.findFirst({
      where: { budgetId },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    return tx.budgetCostCenter.create({
      data: { budgetId, costCenterId, sortOrder: nextSortOrder(last) },
      include: { costCenter: true },
    });
  });
  return NextResponse.json(cc, { status: 201 });
}
