// Cost centres, with the result unit each one's code places it in.
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

// Every reader wants the same rows in the same order and the same shape; only
// which rows differs, so that is the only thing the callers below decide.
async function loadCostCenters(where: Prisma.CostCenterWhereInput): Promise<CostCenter[]> {
  const [ccs, prefixes] = await Promise.all([
    prisma.costCenter.findMany({ where, orderBy: { code: "asc" } }),
    getPrefixes(),
  ]);
  return ccs.map((c) => toCostCenter(c, prefixes));
}

/** Every cost centre, retired ones included, for the settings list. */
export function getCostCenters(): Promise<CostCenter[]> {
  return loadCostCenters({});
}

/**
 * Set (or clear, with null) the short names of several cost centres at once:
 * the settings page's suggestions, saved together, or one edited by hand.
 *
 * Raw SQL rather than `update`, which would stamp `updatedAt` and so make the
 * Fortnox page report a sync that never ran (see getCostCenterSyncStatus). A
 * short name is not a change to the mirrored row; it is this app's own note on
 * it. One transaction, so a batch of suggestions lands whole or not at all.
 * Returns how many rows there were to set.
 */
export async function setCostCenterShortNames(
  names: { id: string; shortName: string | null }[],
): Promise<number> {
  const counts = await prisma.$transaction(
    names.map(
      (n) => prisma.$executeRaw`UPDATE "CostCenter" SET "shortName" = ${n.shortName} WHERE "id" = ${n.id}`,
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/**
 * The Fortnox mirror at a glance, for the sync row on Settings → Fortnox: how
 * many came from Fortnox and when the sync last wrote them. The sync stamps
 * `updatedAt` on every row it upserts, and only a sync touches a Fortnox row
 * (they are read-only here), so the latest one is when it last ran.
 */
export async function getCostCenterSyncStatus(): Promise<{ count: number; lastSyncAt: string | null }> {
  const agg = await prisma.costCenter.aggregate({
    where: { source: "FORTNOX" },
    _count: true,
    _max: { updatedAt: true },
  });
  return { count: agg._count, lastSyncAt: agg._max.updatedAt?.toISOString() ?? null };
}

// Cost centres a picker should offer: the active ones. `keep` forces specific
// codes in even when retired, so a voucher or allocation that already points at
// one still renders and re-saves instead of failing validation. Retiring a
// cost centre must not strand the utlägg already booked against it.
export function getActiveCostCenters(keep: readonly string[] = []): Promise<CostCenter[]> {
  const codes = [...new Set(keep.filter(Boolean))];
  return loadCostCenters(
    codes.length ? { OR: [{ active: true }, { code: { in: codes } }] } : { active: true },
  );
}
