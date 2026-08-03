import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBudget, isAdmin } from "@/lib/domain/permissions";
import { copyBudgetContents } from "@/lib/budget/clone";
import { getBudgetSummaries } from "@/lib/data/budget";
import { fail, gate } from "@/lib/api/guard";

// GET /api/budgets — every budget, shallow. The list page server-renders the
// same call (lib/data/budget.ts); this is here for the compare view, which is a
// client screen because the comparison itself lives in the URL.
export async function GET() {
  const g = await gate(canAccessBudget);
  if (!g.ok) return g.res;

  return NextResponse.json(await getBudgetSummaries());
}

// POST /api/budgets — create a budget (admin only).
//
// `copyFromId` starts it from an existing budget — last year's, or the adopted
// one you are about to draft an alternative to — copying its cost centres,
// accounts, line items and variables. That is all it does: the copy keeps no
// link to its source and the two are strangers from the moment it returns.
export async function POST(req: Request) {
  const g = await gate(isAdmin);
  if (!g.ok) return g.res;

  const body = await req.json().catch(() => ({}));
  const year = typeof body.year === "number" ? body.year : Number(body.year) || new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return fail(422, "budget.invalidYear");
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Ursprunglig";
  const copyFromId = typeof body.copyFromId === "string" && body.copyFromId ? body.copyFromId : null;

  // Fail before creating anything if the chosen source is gone.
  if (copyFromId) {
    const source = await prisma.budget.findUnique({ where: { id: copyFromId }, select: { id: true } });
    if (!source) return fail(404, "budget.sourceNotFound");
  }

  const budget = await prisma.$transaction(async (tx) => {
    const created = await tx.budget.create({ data: { year, name, createdById: g.actor.id } });
    if (copyFromId) await copyBudgetContents(tx, copyFromId, created.id);
    return created;
  });

  return NextResponse.json(budget, { status: 201 });
}
