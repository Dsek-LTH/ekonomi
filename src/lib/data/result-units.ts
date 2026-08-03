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
  const [resultUnits, costCenters, prefixes] = await Promise.all([
    prisma.resultUnit.findMany({
      include: {
        prefixes: { orderBy: { value: "asc" } },
        owners: { include: { user: { select: { id: true, name: true } } } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.costCenter.findMany({
      select: { code: true, name: true, active: true },
      orderBy: { code: "asc" },
    }),
    getPrefixes(),
  ]);

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
