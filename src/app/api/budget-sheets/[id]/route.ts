import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { denyBudgetWrite, denyDeletingAdjusted } from "@/lib/budget/access";
import { fail } from "@/lib/api/guard";

// PATCH /api/budget-sheets/[id] — which cost centre this sheet is, and
// what it is called while it isn't one.
//   { costCenterId: string } link it (the cost centre must be free in this
//                            budget — one cannot be budgeted twice)
//   { costCenterId: null }   detach it, keeping the figures
//   { label: string }        rename a detached sheet
//
// Relinking is deliberately allowed on any sheet, not just a fresh clone: a
// budget drafted before the cost centres were sorted out has to be repointable
// afterwards.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ costCenter: id });
  if (denied) return denied;

  const body = await req.json().catch(() => ({}));
  const data: { costCenterId?: string | null; label?: string | null } = {};

  if ("costCenterId" in body) {
    const costCenterId = typeof body.costCenterId === "string" && body.costCenterId ? body.costCenterId : null;
    if (costCenterId) {
      const cc = await prisma.budgetCostCenter.findUnique({ where: { id }, select: { budgetId: true } });
      if (!cc) return fail(404, "notFound");
      const taken = await prisma.budgetCostCenter.findFirst({
        where: { budgetId: cc.budgetId, costCenterId, NOT: { id } },
        select: { id: true },
      });
      if (taken) {
        return fail(409, "budget.sheetExists");
      }
    }
    data.costCenterId = costCenterId;
  }

  if (typeof body.label === "string") data.label = body.label.trim() || null;

  const updated = await prisma.budgetCostCenter.update({
    where: { id },
    data,
    include: { costCenter: true },
  });
  return NextResponse.json(updated);
}

// DELETE /api/budget-sheets/[id] — drop a cost centre from the budget.
// Its accounts and rows go with it (cascade); other budgets are untouched.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ costCenter: id });
  if (denied) return denied;
  const adjusted = await denyDeletingAdjusted({ costCenter: id });
  if (adjusted) return adjusted;
  await prisma.budgetCostCenter.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
