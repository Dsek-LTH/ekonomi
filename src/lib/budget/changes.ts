// Rules for redaktionella ändringar on a locked budget, shared by the API and the form.
// A FORFLYTTNING must leave the rambudget exactly where it was and stay inside one resultatenhet.
// An AVSTEG must actually move it. Amounts are integer öre, signed in the account's own orientation;
// `parseAmount` is the only place kronor become öre.
import type { AccountKind } from "@/lib/budget";
import { sekToOre } from "@/lib/domain/money";

export type ChangeKind = "AVSTEG" | "FORFLYTTNING";

export interface ResolvedEntry {
  accountId: string;
  amount: number;
  kind: AccountKind;
  scope: string;
  scopeLabel: string;
}

/** Effect of one entry on the result: income and cost are positive magnitudes, so cost is negated. */
export const resultImpact = (kind: AccountKind, amount: number): number =>
  kind === "INCOME" ? amount : -amount;

export const netResultImpact = (
  entries: readonly { kind: AccountKind; amount: number }[],
): number => entries.reduce((sum, e) => sum + resultImpact(e.kind, e.amount), 0);

// Exactly zero: amounts are integer öre.
const isNeutral = (net: number): boolean => net === 0;

/**
 * The resultatenhet a sheet belongs to (the unit a förflyttning may move money inside).
 * A sheet with no result unit is its own, keyed on its id, so unrelated sheets cannot fund each other.
 */
export function scopeKey(sheet: {
  id: string;
  costCenter?: { resultUnit?: string | null } | null;
}): string {
  const resultUnit = sheet.costCenter?.resultUnit?.trim();
  return resultUnit ? `resultatenhet:${resultUnit}` : `blad:${sheet.id}`;
}

export function scopeLabel(
  sheet: {
    costCenter?: { resultUnit?: string | null } | null;
    label?: string | null;
  },
  fallback: string,
): string {
  return sheet.costCenter?.resultUnit?.trim() || fallback;
}

/** Typed belopp to integer öre, or NaN. Accepts spaces and a comma decimal, no formulas. A number passed in is already öre. */
export function parseAmount(raw: string | number): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  const s = raw.replace(/[\s _]/g, "").replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? sekToOre(n) : NaN;
}

/** Why a change may not be recorded. `error` is a code under `errors.budget.changeError`, shown by the form and returned by the API. */
export type Validation =
  { ok: true } | { ok: false; error: string; values?: Record<string, string | number> };

export function validateChange(kind: ChangeKind, entries: readonly ResolvedEntry[]): Validation {
  if (entries.length === 0) {
    return { ok: false, error: "empty" };
  }
  if (entries.some((e) => !Number.isFinite(e.amount))) {
    return { ok: false, error: "notNumbers" };
  }
  if (entries.every((e) => e.amount === 0)) {
    return { ok: false, error: "allZero" };
  }
  // The same account twice nets to one figure but reads as two contradictory decisions.
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.accountId)) {
      return { ok: false, error: "duplicate" };
    }
    seen.add(e.accountId);
  }

  const net = netResultImpact(entries);

  if (kind === "FORFLYTTNING") {
    const scopes = new Set(entries.map((e) => e.scope));
    if (scopes.size > 1) {
      const names = [...new Set(entries.map((e) => e.scopeLabel))].join(", ");
      return { ok: false, error: "crossesScopes", values: { scopes: names } };
    }
    if (!isNeutral(net)) {
      return {
        ok: false,
        error: "notNeutral",
        values: { net: `${net > 0 ? "+" : ""}${Math.round(net)}` },
      };
    }
    return { ok: true };
  }

  if (isNeutral(net)) {
    return { ok: false, error: "noEffect" };
  }
  return { ok: true };
}

interface ChangeLike {
  kind: ChangeKind;
  revokedAt: Date | string | null;
  entries: readonly { accountId: string; amount: number }[];
}

export const isActive = (c: { revokedAt: Date | string | null }): boolean => c.revokedAt == null;

/** Net active adjustment per account id. Everything adding a change into a figure uses this, so revoked changes cannot leak. */
export function adjustmentsByAccount(changes: readonly ChangeLike[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const change of changes) {
    if (!isActive(change)) continue;
    for (const e of change.entries) {
      out.set(e.accountId, (out.get(e.accountId) ?? 0) + e.amount);
    }
  }
  return out;
}

/** "Avsteg #4", "Förflyttning #7". Swedish on purpose: this is stored in text (see budget/clone.ts). */
export const changeLabel = (kind: ChangeKind, seq: number): string =>
  `${kind === "AVSTEG" ? "Avsteg" : "Förflyttning"} #${seq}`;
