// Which result unit a cost centre belongs to is derived, never stored: a cost
// centre is part of the result unit whose prefix its code starts with.
//
// Prefixes are kept non-overlapping (no prefix may be an extension of another),
// so at most one can match a given code and there is never a tie to break. That
// invariant is enforced on write by `prefixConflict` — the database cannot
// express it — and everything downstream may therefore assume it holds.
import { cache } from "react";
import { prisma } from "@/lib/server/db";

export interface PrefixRow {
  value: string; // upper-case
  resultUnitId: string;
  resultUnitName: string;
}

// Normalise as we store: upper-case, no surrounding space. Cost-centre codes
// from Fortnox are upper-case, so matching is done in that case throughout.
export const normalisePrefix = (raw: string) => raw.trim().toUpperCase();

// Deduped per request: a single expense list resolves the result unit of every
// allocation, and without the cache that would re-query for each one.
export const getPrefixes = cache(async (): Promise<PrefixRow[]> => {
  const rows = await prisma.resultUnitPrefix.findMany({
    include: { resultUnit: { select: { id: true, name: true } } },
    // Longest first, so a match is found even if the non-overlap invariant is
    // ever violated by a direct database edit.
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

// The result unit a cost-centre code belongs to, or null when no prefix matches.
export function resultUnitForCode(
  code: string,
  prefixes: PrefixRow[],
): PrefixRow | null {
  const c = code.trim().toUpperCase();
  return prefixes.find((p) => c.startsWith(p.value)) ?? null;
}

// ResultUnit NAME for a code — the shape the UI and the attest check use, since
// result unit names are unique and already the key permissions compare on.
export function resultUnitNameForCode(code: string, prefixes: PrefixRow[]): string | null {
  return resultUnitForCode(code, prefixes)?.resultUnitName ?? null;
}

export interface PrefixConflict {
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

/** The conflict as an error code plus its values — see lib/api/guard.ts. */
export function prefixConflictError(c: PrefixConflict): {
  code: string;
  values: Record<string, string>;
} {
  return {
    code: c.kind === "duplicate" ? "resultUnit.prefixTaken" : `resultUnit.prefix_${c.kind}`,
    values: { resultUnit: c.resultUnitName, prefix: c.value },
  };
}

// Prisma `where` matching every cost centre owned by the given result units.
// Used to scope expense queries without a stored result unit column.
export function costCentreWhereForPrefixes(prefixes: string[]) {
  return { OR: prefixes.map((value) => ({ code: { startsWith: value } })) };
}

// ── The result units a person answers for ─────────────────────────

// Cached on the user id — a primitive, so it dedupes across every caller in a
// request rather than only within one. Expense scoping, attest annotation and
// the transition route all ask this same question.
const ownershipsOf = cache(async (userId: string) => {
  const rows = await prisma.resultUnitOwner.findMany({
    where: { userId },
    include: { resultUnit: { include: { prefixes: { select: { value: true } } } } },
  });
  return {
    names: rows.map((r) => r.resultUnit.name),
    prefixes: rows.flatMap((r) => r.resultUnit.prefixes.map((p) => p.value)),
  };
});

const NO_RESULT_UNITS = { names: [] as string[], prefixes: [] as string[] };

/**
 * The result units `actor` answers for — empty for anyone not holding
 * RESULTATANSVARIG. An ownership only confers authority while the role backs
 * it, so the role is checked here rather than at every call site.
 */
export async function ownedResultUnits(actor: {
  id: string;
  roles: readonly string[];
}): Promise<{ names: string[]; prefixes: string[] }> {
  if (!actor.roles.includes("RESULTATANSVARIG")) return NO_RESULT_UNITS;
  return ownershipsOf(actor.id);
}
