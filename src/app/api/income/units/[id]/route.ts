// Edit or remove a resultatenhet's income profile. The [id] param is the
// profile's id (ResultUnitIncome), not the unit's.
import { NextResponse } from "next/server";

import { fail, gate, orNotFound } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeUnit } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { getPrefixes, resultUnitForCode } from "@/lib/server/result-units";

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
    // Only the unit's own cost centres: another unit's would be attested by its resultatansvariga.
    const income = await prisma.resultUnitIncome.findUnique({
      where: { id },
      select: { resultUnitId: true, resultUnit: { select: { name: true } } },
    });
    if (!income) return fail(404, "income.unitNotFound");
    if (resultUnitForCode(cc.code, await getPrefixes())?.resultUnitId !== income.resultUnitId) {
      return fail(422, "income.costCenterOutsideUnit", {
        values: { code: cc.code, name: income.resultUnit.name },
      });
    }
  }

  const updated = await orNotFound(
    () =>
      prisma.resultUnitIncome.update({
        where: { id },
        data: {
          // An empty string clears back to null ("use the unit's own name").
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

/** Remove the income profile, or retire it when the unit has history (booked reports name it). The result unit itself is never touched. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const income = await prisma.resultUnitIncome.findUnique({
    where: { id },
    include: {
      _count: { select: { prefixes: true } },
      resultUnit: { select: { _count: { select: { incomeReports: true, incomeLines: true } } } },
    },
  });
  if (!income) return fail(404, "income.committeeNotFound");

  const counts = income.resultUnit._count;
  if (counts.incomeReports + counts.incomeLines > 0) {
    await prisma.resultUnitIncome.update({ where: { id }, data: { active: false } });
    return NextResponse.json({ retired: true });
  }

  // Prefixes cascade.
  await prisma.resultUnitIncome.delete({ where: { id } });
  return NextResponse.json({ retired: false });
}
