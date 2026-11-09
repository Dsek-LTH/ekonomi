import "server-only";

import { prisma } from "@/lib/server/db";
import { resultUnitForCode, getPrefixes } from "@/lib/server/result-units";
import type { ResultUnit, ResultUnitCostCenter } from "@/lib/domain/types";

export async function getResultUnitOptions(): Promise<{ id: string; name: string }[]> {
  return prisma.resultUnit.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function getResultUnits(): Promise<ResultUnit[]> {
  const [resultUnits, costCenters, prefixes, accounts, ansvariga] = await Promise.all([
    prisma.resultUnit.findMany({
      include: {
        prefixes: { orderBy: { value: "asc" } },
        groups: { select: { group: true }, orderBy: { group: "asc" } },
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
    prisma.account.findMany({ select: { number: true, name: true } }),
    // Derived from Authentik groups at sign-in, so read-only here.
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
          costCenterId: p.costCenterId,
        })),
      },
    };
  });
}

// Cost centres no prefix claims (inactive ones included, flagged), so an unassigned code is not silently un-attestable.
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
