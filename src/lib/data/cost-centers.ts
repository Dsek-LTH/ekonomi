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
  active: boolean;
  source: CostCenter["source"];
};

const toCostCenter = (c: CostCenterRow, prefixes: PrefixRow[]): CostCenter => ({
  id: c.id,
  code: c.code,
  name: c.name,
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
