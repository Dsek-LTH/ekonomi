import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { resultUnitNameForCode, getPrefixes, type PrefixRow } from "@/lib/server/result-units";
import type { CostCenter } from "@/lib/domain/types";

type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  active: boolean;
  source: CostCenter["source"];
};

const toCostCenter = (c: CostCenterRow, prefixes: PrefixRow[]): CostCenter => ({
  id: c.id,
  code: c.code,
  name: c.name,
  shortName: c.shortName,
  // Derived from the code, never stored, see lib/server/result-units.ts.
  resultUnit: resultUnitNameForCode(c.code, prefixes) ?? undefined,
  active: c.active,
  source: c.source,
});

async function loadCostCenters(where: Prisma.CostCenterWhereInput): Promise<CostCenter[]> {
  const [ccs, prefixes] = await Promise.all([
    prisma.costCenter.findMany({ where, orderBy: { code: "asc" } }),
    getPrefixes(),
  ]);
  return ccs.map((c) => toCostCenter(c, prefixes));
}

export function getCostCenters(): Promise<CostCenter[]> {
  return loadCostCenters({});
}

/**
 * Set (or clear, with null) short names in one transaction. Raw SQL: `update` would stamp
 * `updatedAt` and make the Fortnox page report a sync that never ran (getCostCenterSyncStatus).
 */
export async function setCostCenterShortNames(
  names: { id: string; shortName: string | null }[],
): Promise<number> {
  const counts = await prisma.$transaction(
    names.map(
      (n) =>
        prisma.$executeRaw`UPDATE "CostCenter" SET "shortName" = ${n.shortName} WHERE "id" = ${n.id}`,
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Mirror size and last sync time: the sync stamps `updatedAt` on upsert and only a sync touches a Fortnox row. */
export async function getCostCenterSyncStatus(): Promise<{
  count: number;
  lastSyncAt: string | null;
}> {
  const agg = await prisma.costCenter.aggregate({
    where: { source: "FORTNOX" },
    _count: true,
    _max: { updatedAt: true },
  });
  return { count: agg._count, lastSyncAt: agg._max.updatedAt?.toISOString() ?? null };
}

// `keep` forces codes in even when retired, so already-booked vouchers and allocations still render and re-save.
export function getActiveCostCenters(keep: readonly string[] = []): Promise<CostCenter[]> {
  const codes = [...new Set(keep.filter(Boolean))];
  return loadCostCenters(
    codes.length ? { OR: [{ active: true }, { code: { in: codes } }] } : { active: true },
  );
}
