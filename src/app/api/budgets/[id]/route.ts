import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBudget, canLockBudget } from "@/lib/domain/permissions";
import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchBudget } from "@/lib/api/schemas/budget";
import { allowBudgetWrite } from "@/lib/budget/access";
import { getEvaluatedBudget } from "@/lib/data/budget";

// GET /api/budgets/[id]: one budget, evaluated, with the year's outcome beside
// it. The loading lives in lib/data/budget.ts, which the page server-renders
// from; this is the same thing over HTTP, for the client to re-fetch after a
// write.
//
// Two things can be left out of it, and the page's own re-fetch after a write
// leaves out both:
//
//   ?actuals=0    the year's outcome. The ledger cannot have changed because
//                 someone typed a figure into a budget, and reading it is the
//                 most expensive thing here by a distance: a group-by over the
//                 whole financial year, paid on every save.
//   ?evaluated=0  what the formulas come to. The budget screen works those out
//                 in the browser for every cell it commits already, so sending
//                 them means evaluating the budget twice and putting every
//                 line's figure in the response for one of the two.
//
// Both default to on, because a caller that has neither in hand, anything
// reading a budget cold, needs them.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canAccessBudget);
  if (!g.ok) return g.res;

  const q = new URL(req.url).searchParams;
  const budget = await getEvaluatedBudget(id, {
    actuals: q.get("actuals") !== "0",
    evaluated: q.get("evaluated") !== "0",
    serialize: false,
  });
  if (!budget) return fail(404, "budget.notFound");
  return NextResponse.json(budget);
}

// PATCH /api/budgets/[id]: rename / move year (admin, unlocked), or lock and
// unlock (skattmästare). The two go through different gates, so they are handled
// apart rather than folded into one permission check.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = await parseBody(req, PatchBudget);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  if (body.locked !== undefined) {
    const g = await gate(canLockBudget, "auth.treasurerLockBudget");
    if (!g.ok) return g.res;

    const lock = body.locked;
    // This branch runs before `allowBudgetWrite`, which is what establishes the
    // budget exists everywhere else in this file, so locking one that isn't
    // there reached Prisma unguarded and came back a 500.
    const budget = await orNotFound(
      () =>
        prisma.budget.update({
          where: { id },
          // Cleared together, so "locked" is never half-true.
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

  // The year is more than a label: it decides which financial year's outcome the
  // budget is held against. It moves this budget alone. Another budget of the
  // same year is a separate thing and stays where it is.
  if (body.year !== undefined) data.year = body.year;

  // A plain date, so it is read back as the day the meeting sat rather than
  // that day shifted by whatever the reader's timezone is. Sent as YYYY-MM-DD
  // and stored in a DATE column; the UTC midnight in between is the only way to
  // get a Date object through Prisma without a zone deciding which day it means.
  if (body.adoptedAt !== undefined) {
    data.adoptedAt = body.adoptedAt === null ? null : new Date(`${body.adoptedAt}T00:00:00Z`);
  }

  if (Object.keys(data).length === 0) return fail(422, "request.nothingToChange");

  // `allowBudgetWrite` has established it exists; this covers the gap between
  // that statement and this one.
  const budget = await orNotFound(
    () => prisma.budget.update({ where: { id }, data }),
    "budget.notFound",
  );
  if (budget instanceof NextResponse) return budget;
  return NextResponse.json(budget);
}

// DELETE /api/budgets/[id]: admin only, and never a locked one. Nothing hangs
// off a budget, so there is no last-one-standing rule to enforce: a section may
// have no budget as easily as it may have five.
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
