// A cost centre belongs to the result unit whose prefix its code starts with (derived, never stored).
// Prefixes are kept non-overlapping, enforced on write by `prefixConflict`, so at most one matches.
import { cache } from "react";
import { prisma } from "@/lib/server/db";

export interface PrefixRow {
  value: string; // upper-case
  resultUnitId: string;
  resultUnitName: string;
}

// Normalise as we store: upper-case, no surrounding space (Fortnox codes are upper-case).
export const normalisePrefix = (raw: string) => raw.trim().toUpperCase();

// Deduped per request: an expense list resolves the result unit of every allocation.
export const getPrefixes = cache(async (): Promise<PrefixRow[]> => {
  const rows = await prisma.resultUnitPrefix.findMany({
    include: { resultUnit: { select: { id: true, name: true } } },
    // Longest first, in case the non-overlap invariant is violated by a direct database edit.
    orderBy: [{ value: "desc" }],
  });
  return rows
    .map((p) => ({
      value: p.value,
      resultUnitId: p.resultUnitId,
      resultUnitName: p.resultUnit.name,
    }))
    .sort((a, b) => b.value.length - a.value.length);
});

export function resultUnitForCode(code: string, prefixes: PrefixRow[]): PrefixRow | null {
  const c = code.trim().toUpperCase();
  return prefixes.find((p) => c.startsWith(p.value)) ?? null;
}

// ResultUnit NAME for a code (names are unique and the key permissions compare on).
export function resultUnitNameForCode(code: string, prefixes: PrefixRow[]): string | null {
  return resultUnitForCode(code, prefixes)?.resultUnitName ?? null;
}

interface PrefixConflict {
  value: string;
  resultUnitName: string;
  // "extends": the new prefix starts with an existing one (S exists, adding SKT)
  // "extendedBy": an existing prefix starts with the new one (SKT exists, adding S)
  kind: "duplicate" | "extends" | "extendedBy";
}

// The existing prefix that would make `candidate` ambiguous, or null when it is
// safe to add. `ignoreId` skips a row being edited in place.
export async function prefixConflict(
  candidate: string,
  ignoreId?: string,
): Promise<PrefixConflict | null> {
  const value = normalisePrefix(candidate);
  if (!value) return null;

  const existing = await prisma.resultUnitPrefix.findMany({
    where: ignoreId ? { id: { not: ignoreId } } : {},
    include: { resultUnit: { select: { name: true } } },
  });

  for (const p of existing) {
    if (p.value === value) {
      return { value: p.value, resultUnitName: p.resultUnit.name, kind: "duplicate" };
    }
    if (value.startsWith(p.value)) {
      return { value: p.value, resultUnitName: p.resultUnit.name, kind: "extends" };
    }
    if (p.value.startsWith(value)) {
      return { value: p.value, resultUnitName: p.resultUnit.name, kind: "extendedBy" };
    }
  }
  return null;
}

/** The conflict as an error code plus its values. See lib/api/guard.ts. */
export function prefixConflictError(c: PrefixConflict): {
  code: string;
  values: Record<string, string>;
} {
  return {
    code: c.kind === "duplicate" ? "resultUnit.prefixTaken" : `resultUnit.prefix_${c.kind}`,
    values: { resultUnit: c.resultUnitName, prefix: c.value },
  };
}

export function costCentreWhereForPrefixes(prefixes: string[]) {
  return { OR: prefixes.map((value) => ({ code: { startsWith: value } })) };
}

// Cached on the user id (a primitive) so it dedupes across every caller in a request. User.resultUnits holds
// names (lib/server/authentik-roles.ts); prefixes are resolved here so edits apply on the next request. A
// name with no ResultUnit row contributes nothing (reported in Inställningar → Resultatenheter).
const ownershipsOf = cache(async (userId: string) => {
  const [user, prefixes] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { resultUnits: true } }),
    getPrefixes(),
  ]);
  const names = user?.resultUnits ?? [];
  const owned = new Set(names);
  return {
    names,
    prefixes: prefixes.filter((p) => owned.has(p.resultUnitName)).map((p) => p.value),
  };
});

const NO_RESULT_UNITS = { names: [] as string[], prefixes: [] as string[] };

/** The result units `actor` answers for: empty for anyone not holding RESULTATANSVARIG. */
export async function ownedResultUnits(actor: {
  id: string;
  roles: readonly string[];
}): Promise<{ names: string[]; prefixes: string[] }> {
  if (!actor.roles.includes("RESULTATANSVARIG")) return NO_RESULT_UNITS;
  return ownershipsOf(actor.id);
}
