// Where income lands, and what Zettle's own fees cost. Part of
// BookkeepingSettings, which is a single row.
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { UpdateIncomeSettings } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function PATCH(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, UpdateIncomeSettings);
  if (!parsed.ok) return parsed.res;
  const data = parsed.data;

  if (data.incomeFallbackIncomeId) {
    const income = await prisma.resultUnitIncome.findUnique({ where: { id: data.incomeFallbackIncomeId } });
    if (!income) return fail(422, "income.committeeNotFound");
  }

  if (data.zettleFeeCostCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: data.zettleFeeCostCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
  }

  // Creating the row writes only what was chosen. No column has a default, so
  // everything else stays unset. See lib/server/bookkeeping-settings.ts.
  await prisma.bookkeepingSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ...data },
    update: data,
  });

  return new Response(null, { status: 204 });
}
