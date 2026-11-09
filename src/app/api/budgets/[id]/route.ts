import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBudget, canLockBudget } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchBudget } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { getEvaluatedBudget } from "@/lib/data/budget";

// ?actuals=0 skips the year's outcome (a costly group-by) and ?evaluated=0 skips formula results (the client computes them). Both default to on.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessBudget);
  if (!g.ok) return g.res;

  const q = new URL(req.url).searchParams;
  const budget = await getEvaluatedBudget(id, {
    actuals: q.get("actuals") !== "0",
    evaluated: q.get("evaluated") !== "0",
  });
  if (!budget) return fail(404, "budget.notFound");
  return NextResponse.json(budget);
}

// Rename or move year is admin-only on an unlocked budget, lock and unlock is skattmästare: different gates.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchBudget);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  if (body.locked !== undefined) {
    const g = await gate(canLockBudget, "auth.treasurerLockBudget");
    if (!g.ok) return g.res;

    const lock = body.locked;
    // Runs before allowBudgetWrite, so a missing budget would reach Prisma and 500.
    const budget = await orNotFound(
      () =>
        prisma.budget.update({
          where: { id },
          data: lock
            ? { lockedAt: new Date(), lockedById: g.actor.id }
            : { lockedAt: null, lockedById: null },
        }),
      "budget.notFound",
    );
    if (budget instanceof NextResponse) return budget;
    return NextResponse.json(budget);
  }

  const g = await allowBudgetWrite({ budget: id });
  if (!g.ok) return g.res;

  const data: { name?: string; year?: number; adoptedAt?: Date | null } = {};

  if (body.name !== undefined) data.name = body.name;

  // The year decides which financial year's outcome the budget is held against.
  if (body.year !== undefined) data.year = body.year;

  // A plain date: stored as UTC midnight so the reader's timezone cannot shift the day.
  if (body.adoptedAt !== undefined) {
    data.adoptedAt = body.adoptedAt === null ? null : new Date(`${body.adoptedAt}T00:00:00Z`);
  }

  if (Object.keys(data).length === 0) return fail(422, "request.nothingToChange");

  const budget = await orNotFound(
    () => prisma.budget.update({ where: { id }, data }),
    "budget.notFound",
  );
  if (budget instanceof NextResponse) return budget;
  return NextResponse.json(budget);
}

// DELETE /api/budgets/[id]: admin only, never a locked budget.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await allowBudgetWrite({ budget: id });
  if (!g.ok) return g.res;

  const deleted = await orNotFound(
    () => prisma.budget.delete({ where: { id } }),
    "budget.notFound",
  );
  if (deleted instanceof NextResponse) return deleted;
  return new Response(null, { status: 204 });
}
