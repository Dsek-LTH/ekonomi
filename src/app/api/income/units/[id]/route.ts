// Edit or remove a resultatenhet's income profile. The [id] param is the
// profile's id (ResultUnitIncome), not the unit's.
import { NextResponse } from "next/server";

import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeUnit } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeUnit);
  if (!parsed.ok) return parsed.res;
  const { properName, description, defaultCostCenterId, active } = parsed.data;

  if (defaultCostCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
  }

  const updated = await orNotFound(
    () =>
      prisma.resultUnitIncome.update({
        where: { id },
        data: {
          // Cleared back to null means "use the unit's own name", which is the
          // ordinary case, so an empty string is a removal, not a blank name.
          ...(properName !== undefined && { properName: properName || null }),
          ...(description !== undefined && { description }),
          ...(defaultCostCenterId !== undefined && { defaultCostCenterId }),
          ...(active !== undefined && { active }),
        },
        select: { id: true },
      }),
    "income.committeeNotFound",
  );
  if (updated instanceof NextResponse) return updated;

  return new Response(null, { status: 204 });
}

/**
 * Remove the income profile, or retire it when the unit has history.
 *
 * The same shape as retiring a cost centre, and for the same reason: reports
 * already booked name the unit, and its settings are what say how they were
 * routed. Retiring keeps the books readable and takes the unit out of the
 * routing table sent to intakt, which is all anybody actually wanted.
 *
 * The result unit itself is never touched. Deciding that a verksamhet no longer
 * sells anything is not deciding that it has stopped existing; it still owns its
 * cost centres and its resultatansvariga.
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const income = await prisma.resultUnitIncome.findUnique({
    where: { id },
    include: {
      _count: { select: { prefixes: true } },
      resultUnit: { select: { _count: { select: { incomeReports: true } } } },
    },
  });
  if (!income) return fail(404, "income.committeeNotFound");

  if (income.resultUnit._count.incomeReports > 0) {
    await prisma.resultUnitIncome.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ retired: true });
  }

  // Prefixes cascade, so a verksamhet that never took anything in takes its
  // routing with it rather than leaving prefixes pointing at nothing.
  await prisma.resultUnitIncome.delete({ where: { id } });
  return NextResponse.json({ retired: false });
}
