// Give a resultatenhet an income profile (key its reports group by, verifikation text, cost centre).
// The unit itself already exists as a ResultUnit.

import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateIncomeUnit } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { incomeKeyFromName } from "@/lib/income/voucher";
import { prisma } from "@/lib/server/db";
import { getPrefixes, resultUnitForCode } from "@/lib/server/result-units";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateIncomeUnit);
  if (!parsed.ok) return parsed.res;
  const { resultUnitId, description, properName, defaultCostCenterId } = parsed.data;

  const unit = await prisma.resultUnit.findUnique({
    where: { id: resultUnitId },
    include: { income: { select: { id: true } } },
  });
  if (!unit) return fail(404, "income.unitNotFound");
  // One profile per unit.
  if (unit.income) return fail(409, "income.unitHasIncome", { values: { name: unit.name } });

  // Derived from the name (incomeKeyFromName). A clash means names differing only in punctuation or diacritics.
  const key = incomeKeyFromName(unit.name);
  if (!key) return fail(422, "income.keyFromName", { values: { name: unit.name } });
  const taken = await prisma.resultUnitIncome.findUnique({ where: { key } });
  if (taken) return fail(409, "income.committeeExists", { values: { key } });

  if (defaultCostCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
    // Only one of the unit's own cost centres. See the PATCH beside this.
    if (resultUnitForCode(cc.code, await getPrefixes())?.resultUnitId !== unit.id) {
      return fail(422, "income.costCenterOutsideUnit", {
        values: { code: cc.code, name: unit.name },
      });
    }
  }

  const income = await prisma.resultUnitIncome.create({
    data: {
      resultUnitId,
      key,
      description,
      // Null unless the documents need a different form of the unit's name.
      properName: properName || null,
      defaultCostCenterId: defaultCostCenterId ?? null,
    },
  });
  return NextResponse.json({ id: income.id }, { status: 201 });
}
