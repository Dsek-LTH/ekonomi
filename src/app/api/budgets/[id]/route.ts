import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBudget, canLockBudget } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { denyBudgetWrite } from "@/lib/budget/access";
import { getEvaluatedBudget } from "@/lib/data/budget";

// GET /api/budgets/[id] — one budget, evaluated, with the year's outcome beside
// it. The loading lives in lib/data/budget.ts, which the page server-renders
// from; this is the same thing over HTTP, for the client to re-fetch after a
// write.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessBudget);
  if (!g.ok) return g.res;

  const budget = await getEvaluatedBudget(id);
  if (!budget) return fail(404, "budget.notFound");
  return NextResponse.json(budget);
}

// PATCH /api/budgets/[id] — rename / move year (admin, unlocked), or lock and
// unlock (skattmästare). The two go through different gates, so they are handled
// apart rather than folded into one permission check.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  if ("locked" in body) {
    const g = await gate(canLockBudget, "auth.treasurerLockBudget");
    if (!g.ok) return g.res;

    const lock = body.locked === true;
    const budget = await prisma.budget.update({
      where: { id },
      // Cleared together, so "locked" is never half-true.
      data: lock
        ? { lockedAt: new Date(), lockedById: g.actor.id }
        : { lockedAt: null, lockedById: null },
    });
    return NextResponse.json(budget);
  }

  const denied = await denyBudgetWrite({ budget: id });
  if (denied) return denied;

  const data: { name?: string; year?: number } = {};

  if ("name" in body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return fail(422, "resultUnit.nameRequired");
    data.name = name;
  }

  // The year is more than a label: it decides which financial year's outcome the
  // budget is held against. It moves this budget alone — another budget of the
  // same year is a separate thing and stays where it is.
  if ("year" in body) {
    const year = typeof body.year === "number" ? body.year : Number(body.year);
    if (!Number.isInteger(year) || year < 1900 || year > 2200) {
      return fail(422, "budget.invalidYear");
    }
    data.year = year;
  }

  if (Object.keys(data).length === 0) return fail(422, "request.nothingToChange");

  const budget = await prisma.budget.update({ where: { id }, data });
  return NextResponse.json(budget);
}

// DELETE /api/budgets/[id] — admin only, and never a locked one. Nothing hangs
// off a budget, so there is no last-one-standing rule to enforce: a section may
// have no budget as easily as it may have five.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const denied = await denyBudgetWrite({ budget: id });
  if (denied) return denied;

  await prisma.budget.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
