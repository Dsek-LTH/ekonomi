// Give a resultatenhet an income profile: the settings that let it take money
// in: the key intakt groups its reports by, the text its verifikationer carry,
// and the cost centre they are booked against.
//
// The unit itself is not created here. There is one register of the section's
// verksamheter (ResultUnit, under Inställningar → Resultatenheter) and this
// adds the income half of a row already in it, rather than a second list beside
// it, which is what IncomeCommittee was.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateIncomeUnit } from "@/lib/api/schemas/income";
import { canAccessSettings } from "@/lib/domain/permissions";
import { incomeKeyFromName } from "@/lib/income/voucher";
import { prisma } from "@/lib/server/db";

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
  // One profile per unit: the whole point of the merge is that a verksamhet is
  // one thing, so it cannot have two sets of income settings.
  if (unit.income) return fail(409, "income.unitHasIncome", { values: { name: unit.name } });

  // Derived from the name rather than typed: see incomeKeyFromName. A clash
  // means two units whose names differ only in punctuation or diacritics, which
  // is worth refusing rather than silently routing both to one key.
  const key = incomeKeyFromName(unit.name);
  if (!key) return fail(422, "income.keyFromName", { values: { name: unit.name } });
  const taken = await prisma.resultUnitIncome.findUnique({ where: { key } });
  if (taken) return fail(409, "income.committeeExists", { values: { key } });

  if (defaultCostCenterId) {
    const cc = await prisma.costCenter.findUnique({ where: { id: defaultCostCenterId } });
    if (!cc) return fail(422, "income.unknownCostCenter");
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
