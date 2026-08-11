// Result units, their prefixes, their resultatansvariga — and which cost centres
// those prefixes currently claim.
import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitForCode, getPrefixes } from "@/lib/server/result-units";
import type { ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

// Result units with their prefixes, their resultatansvariga, and the cost centres
// each one currently owns. The cost centres are resolved from the prefixes, so
// the list always reflects what a code would actually match right now.
export async function getResultUnits(): Promise<ResultUnit[]> {
  const [resultUnits, costCenters, prefixes, accounts] = await Promise.all([
    prisma.resultUnit.findMany({
      include: {
        prefixes: { orderBy: { value: "asc" } },
        owners: { include: { user: { select: { id: true, name: true } } } },
        // The income half, read here so a unit is one object on the screen that
        // edits it. Nothing outside the income section reads it.
        income: {
          include: {
            defaultCostCenter: { select: { id: true, code: true } },
            prefixes: { orderBy: { code: "asc" } },
          },
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.costCenter.findMany({
      select: { code: true, name: true, active: true },
      orderBy: { code: "asc" },
    }),
    getPrefixes(),
    // Only to name the accounts the product prefixes point at — and to let the
    // screen say when one is not in the chart at all.
    prisma.account.findMany({ select: { number: true, name: true } }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const membersOf = new Map<string, ResultUnitCostCenter[]>();
  for (const cc of costCenters) {
    const owner = resultUnitForCode(cc.code, prefixes);
    if (!owner) continue;
    const list = membersOf.get(owner.resultUnitId) ?? [];
    list.push(cc);
    membersOf.set(owner.resultUnitId, list);
  }

  return resultUnits.map((c) => {
    const members = membersOf.get(c.id) ?? [];
    return {
      id: c.id,
      resultUnit: c.name,
      prefixes: c.prefixes.map((p) => ({ id: p.id, value: p.value })),
      owners: c.owners
        .map((m) => ({ id: m.user.id, name: m.user.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      costCenters: members,
      // Retired cost centres shouldn't inflate the headline count.
      costCenterCount: members.filter((cc) => cc.active).length,
      income: c.income && {
        id: c.income.id,
        key: c.income.key,
        description: c.income.description,
        defaultCostCenterId: c.income.defaultCostCenter?.id ?? null,
        defaultCostCenterCode: c.income.defaultCostCenter?.code ?? null,
        active: c.income.active,
        prefixes: c.income.prefixes.map((p) => ({
          id: p.id,
          code: p.code,
          account: p.account,
          accountName: accountName.get(p.account) ?? "",
          isFallback: p.isFallback,
        })),
      },
    };
  });
}

// Cost centres no prefix claims — surfaced in the settings tab so an unassigned
// code doesn't quietly become un-attestable by anyone but an admin. Inactive
// ones are included (flagged), since they're grouped separately in the UI.
export async function getUnassignedCostCenters(): Promise<ResultUnitCostCenter[]> {
  const [costCenters, prefixes] = await Promise.all([
    prisma.costCenter.findMany({
      select: { code: true, name: true, active: true },
      orderBy: { code: "asc" },
    }),
    getPrefixes(),
  ]);
  return costCenters.filter((cc) => !resultUnitForCode(cc.code, prefixes));
}
