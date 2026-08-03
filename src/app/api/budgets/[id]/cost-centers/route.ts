import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite } from "@/lib/budget/access";
import { cloneCostCenter } from "@/lib/budget/clone";
import { fail } from "@/lib/api/guard";

// POST /api/budgets/[id]/cost-centers
//   { costCenterId } — add a cost centre to the budget
//   { cloneFromId }  — duplicate a sheet already in it, detached from any cost
//                      centre (see cloneCostCenter)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: budgetId } = await ctx.params;
  const denied = await denyBudgetWrite({ budget: budgetId });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const cloneFromId = typeof body.cloneFromId === "string" ? body.cloneFromId : null;

  if (cloneFromId) {
    const source = await prisma.budgetCostCenter.findUnique({
      where: { id: cloneFromId },
      select: { budgetId: true },
    });
    // Cloning out of another budget would sidestep that budget's own lock, and
    // isn't what the button means.
    if (!source || source.budgetId !== budgetId) {
      return fail(404, "budget.sheetNotFound");
    }
    const cloneId = await prisma.$transaction((tx) => cloneCostCenter(tx, cloneFromId));
    const clone = await prisma.budgetCostCenter.findUnique({ where: { id: cloneId! } });
    return NextResponse.json(clone, { status: 201 });
  }

  const costCenterId = typeof body.costCenterId === "string" ? body.costCenterId : null;
  if (!costCenterId) return fail(422, "request.costCenterIdRequired");

  const last = await prisma.budgetCostCenter.findFirst({ where: { budgetId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const cc = await prisma.budgetCostCenter.create({
    data: { budgetId, costCenterId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: { costCenter: true },
  });
  return NextResponse.json(cc, { status: 201 });
}
