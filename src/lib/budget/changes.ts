// Redaktionella ändringar på en låst budget: the arithmetic that decides what a
// change is allowed to be, shared by the API that writes one and the form that
// composes it, so the two can never disagree about what will be accepted.
//
// See BudgetChange in schema.prisma for what the two kinds mean. The rules here
// are only about the numbers:
//
//   • A FORFLYTTNING must leave the rambudget exactly where it was, and must
//     stay inside one resultatenhet.
//   • An AVSTEG must actually move it — a change that nets to nothing is a
//     förflyttning, whatever it was called when it was entered.
//
// Everything is in SEK, signed in the account's own orientation (see
// BudgetAdjustment), because that is the direction the sheet budgets in and so
// the only one a person entering a change is thinking in.
import type { AccountKind } from "@/lib/budget";

export type ChangeKind = "AVSTEG" | "FORFLYTTNING";

/** One account's share of a change, resolved far enough to be checked. */
export interface ResolvedEntry {
  accountId: string;
  amount: number;
  kind: AccountKind;
  /** Which resultatenhet the account's sheet belongs to — see `scopeKey`. */
  scope: string;
  /** What that resultatenhet is called, for the error message. */
  scopeLabel: string;
}

// Amounts are kronor typed by hand and summed as doubles; two of them that
// should cancel can miss by a fraction of an öre. Anything under half an öre is
// zero as far as these rules are concerned.
const EPSILON = 0.005;

/**
 * What one entry does to the result (och därmed till rambudgeten). Income and
 * cost are both budgeted as positive magnitudes, so the sign has to be put back
 * before they can be added together: 500 kr more income lifts the result by 500,
 * 500 kr more cost drops it by 500.
 */
export const resultImpact = (kind: AccountKind, amount: number): number =>
  kind === "INCOME" ? amount : -amount;

/** A whole change's effect on the result. Zero (within EPSILON) = rambudgeten står still. */
export const netResultImpact = (entries: readonly { kind: AccountKind; amount: number }[]): number =>
  entries.reduce((sum, e) => sum + resultImpact(e.kind, e.amount), 0);

const isNeutral = (net: number): boolean => Math.abs(net) < EPSILON;

/**
 * Which resultatenhet a sheet belongs to — the unit a förflyttning may move
 * money inside. That is the result unit: Sexmästeriet is one resultatenhet, and
 * moving between SEX01 and SEX02 leaves it whole.
 *
 * A sheet with no result unit to derive one from (not linked to a cost centre, or
 * linked to one no prefix matches) is its own resultatenhet, keyed on its own
 * id. Falling back to a shared "no result unit" bucket would let two unrelated
 * sheets fund each other, which is the one thing this key exists to prevent.
 */
export function scopeKey(sheet: {
  id: string;
  costCenter?: { resultUnit?: string | null } | null;
}): string {
  const resultUnit = sheet.costCenter?.resultUnit?.trim();
  return resultUnit ? `resultatenhet:${resultUnit}` : `blad:${sheet.id}`;
}

/** What to call that unit when explaining why a transfer was refused. */
export function scopeLabel(sheet: {
  costCenter?: { resultUnit?: string | null } | null;
  label?: string | null;
}, fallback: string): string {
  return sheet.costCenter?.resultUnit?.trim() || fallback;
}

/**
 * What was typed in a belopp field → kronor, or NaN when it isn't a number.
 * Forgiving about how Swedes write one (spaces as thousands separators, a comma
 * for the decimal point) and about nothing else: a change is a decided amount,
 * so unlike a line item it takes no formula.
 */
export function parseAmount(raw: string | number): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : NaN;
  const s = raw.replace(/[\s _]/g, "").replace(",", ".");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Why a change may not be recorded. `error` is a code under
 * `errors.budget.changeError` in messages, not prose: the same verdict is shown
 * to the treasurer composing the change *and* returned by the API as an error
 * code, and both readers have their own language. It lives under `errors`
 * because that is the namespace the API's codes resolve in
 * (lib/ui/api-error.ts) — one string serving both, rather than two copies that
 * drift. `values` fills the code's placeholders.
 */
export type Validation =
  | { ok: true }
  | { ok: false; error: string; values?: Record<string, string | number> };

/** Whether these entries may be recorded as a change of this kind. */
export function validateChange(kind: ChangeKind, entries: readonly ResolvedEntry[]): Validation {
  if (entries.length === 0) {
    return { ok: false, error: "empty" };
  }
  if (entries.some((e) => !Number.isFinite(e.amount))) {
    return { ok: false, error: "notNumbers" };
  }
  if (entries.every((e) => Math.abs(e.amount) < EPSILON)) {
    return { ok: false, error: "allZero" };
  }
  // The same account twice in one change nets to a single figure anyway, and
  // reads as two contradictory decisions in the history.
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

/** The shape both the server and the client hold a change in. */
export interface ChangeLike {
  kind: ChangeKind;
  revokedAt: Date | string | null;
  entries: readonly { accountId: string; amount: number }[];
}

/** A change still counts towards the figures until it is revoked. */
export const isActive = (c: { revokedAt: Date | string | null }): boolean => c.revokedAt == null;

/**
 * Net active adjustment per account id. Everything that has to add a change into
 * a figure — the evaluator's account totals, the sheet, the rambudget — goes
 * through this, so a revoked change can never leak into one of them.
 */
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

/**
 * What a change is called: "Avsteg #4", "Förflyttning #7". Swedish on purpose —
 * this names a change inside text that gets *stored* (see budget/clone.ts). A
 * screen showing a change to a reader uses `budget.changes.label` instead.
 */
export const changeLabel = (kind: ChangeKind, seq: number): string =>
  `${kind === "AVSTEG" ? "Avsteg" : "Förflyttning"} #${seq}`;
