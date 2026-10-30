// Result units, their prefixes, their resultatansvariga, and which cost centres
// those prefixes currently claim.
import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitForCode, getPrefixes } from "@/lib/server/result-units";
import type { ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

// Just the units, for a picker that only needs to name one.
export async function getResultUnitOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.resultUnit.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

// Result units with their prefixes, their resultatansvariga, and the cost centres
// each one currently owns. The cost centres are resolved from the prefixes, so
// the list always reflects what a code would actually match right now.
export async function getResultUnits(): Promise<ResultUnit[]> {
  const [resultUnits, costCenters, prefixes, accounts, ansvariga] = await Promise.all([
    prisma.resultUnit.findMany({
      include: {
        prefixes: { orderBy: { value: "asc" } },
        // The Authentik groups that make someone answer for this unit. A
        // foreign key now rather than a name written in a file, which is why
        // there is no longer a "mapped to a unit that does not exist" case for
        // the screen to report. The database will not hold one.
        groups: { select: { group: true }, orderBy: { group: "asc" } },
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
    // Only to name the accounts the product prefixes point at, and to let the
    // screen say when one is not in the chart at all.
    prisma.account.findMany({ select: { number: true, name: true } }),
    // Everyone who answers for anything. Derived from the Authentik group list
    // at sign-in, so this is a report of who currently holds the mapped groups
    // not something the screen can edit.
    prisma.user.findMany({
      where: { resultUnits: { isEmpty: false } },
      select: { id: true, name: true, resultUnits: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));

  const ansvarigaOf = new Map<string, { id: string; name: string }[]>();
  for (const u of ansvariga) {
    for (const unit of u.resultUnits) {
      const list = ansvarigaOf.get(unit) ?? [];
      list.push({ id: u.id, name: u.name });
      ansvarigaOf.set(unit, list);
    }
  }

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
      ownerGroups: c.groups.map((g) => g.group),
      owners: ansvarigaOf.get(c.name) ?? [],
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
        })),
      },
    };
  });
}

// Cost centres no prefix claims, surfaced in the settings tab so an unassigned
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
