// Pure helpers + constants shared across the budget sheets.
import type { DragEvent } from "react";
import { effectiveKind, sheetKey } from "@/lib/budget";
import { isActive, resultImpact } from "@/lib/budget/changes";
import { compareKey, type Totals } from "@/lib/budget/compare";
import type { Budget, BudgetCC, BudgetChange, Evaluated } from "./budget-types";

export const RAMBUDGET = "__rambudget__";
export const VARS = "__vars__";
export const CHANGES = "__changes__";
// The two groups that are not a result unit. Sentinels rather than words: they
// share a namespace with real result unit names, and they are wording the screen
// resolves through `budget.group.<key>`.
export const OTHER = "__other__";
// Sheets with no cost centre behind them yet. Their own group rather than
// OTHER: that one means "belongs to no result unit", this one means "not decided
// yet", and the second is a to-do.
export const UNLINKED = "__unlinked__";

/** A group heading as it reads on screen. `t` is scoped to `budget.group`. */
export const resultUnitLabel = (resultUnit: string, t: (key: string) => string): string =>
  resultUnit === OTHER || resultUnit === UNLINKED ? t(resultUnit.replace(/__/g, "")) : resultUnit;

// How a sheet is bucketed in the sidebar.
export const resultUnitOf = (cc: BudgetCC): string =>
  cc.costCenter ? cc.costCenter.resultUnit || OTHER : UNLINKED;

// The same, for a sheet that came out of a comparison and so may belong to a
// budget other than this one — or to no budget at all, when it is something the
// ledger reports on. A detached sheet is matched on its label, which is what
// gives its key the "@"/"#" that marks it as linked to no cost centre (see
// compareKey in lib/budget/compare.ts).
export const resultUnitOfSheet = (s: { key: string; resultUnit: string | null }): string =>
  /^[@#]/.test(s.key) ? UNLINKED : s.resultUnit || OTHER;

// Belopp cells hold the equation itself (e.g. "=2*TROJA_POLICY"). We show the
// equation with typographic operators — "2 × TROJA_POLICY" — and, on the Belopp
// column, append its evaluated result. Entry is forgiving: people can type
// "2x3x12" and it becomes a formula.

// A formula string (with leading "=", already in A1-display form) → a readable
// equation without the "=", using × ÷ and spaced operators. Non-formula input
// (a plain literal) is returned unchanged.
export function prettyFormula(formulaText: string): string {
  const s = formulaText.trim();
  if (!s.startsWith("=")) return s;
  return s.slice(1)
    .replace(/\*/g, " × ")
    .replace(/\//g, " ÷ ")
    .replace(/\+/g, " + ")
    .replace(/([\w)%.])-([\w(])/g, "$1 − $2") // binary minus only (keep unary/negatives)
    .replace(/\s+/g, " ")
    .trim();
}

// Turn 'x' / 'X' / '·' used as multiplication (flanked by a number or paren)
// into '*', without touching the same letters inside identifiers.
function normalizeMul(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "x" || c === "X" || c === "·") {
      const prev = out.replace(/\s+$/, "").slice(-1);
      const next = s.slice(i + 1).match(/^\s*(\S)/)?.[1] ?? "";
      // A number or ")" on the left, and a number, "(" or a variable on the
      // right → this 'x' is multiplication. Never convert after a letter, so
      // identifiers like MAXx stay intact.
      if (/[\d)]/.test(prev) && /[\d(A-Za-z_]/.test(next)) { out += "*"; continue; }
    }
    out += c;
  }
  return out;
}

// What the user typed → what we store. A leading "=" is honoured; otherwise a
// bare entry that carries an operator or an identifier (a variable / account
// ref) is promoted to a formula, while a plain number/percentage stays literal.
// ×, ÷ and a numeric 'x' are normalised to * and /.
export function normalizeFormula(raw: string): string {
  const s = raw.trim();
  if (s === "") return s;
  const lead = s.startsWith("=");
  // Normalise to the canonical stored form: * / for ×/÷ and a numeric 'x', and
  // no spaces around arithmetic operators (but keep commas, so account(CC, ACCT)
  // tokens round-trip). This keeps a focus→blur with no edit a true no-op.
  const body = normalizeMul(lead ? s.slice(1) : s)
    .replace(/×/g, "*").replace(/÷/g, "/")
    .replace(/\s*([*/+\-()])\s*/g, "$1")
    .trim();
  if (lead) return "=" + body;
  const numeric = /^-?[\d\s._]+%?$/.test(body.replace(",", "."));
  if (numeric) return body;
  if (/[+\-*/()]/.test(body) || /[A-Za-z_]/.test(body)) return "=" + body;
  return body;
}

// True while the drag pointer is still inside the element's box. Used to keep a
// drop highlight from flashing: dragleave fires every time the pointer crosses
// onto a child element, so we only clear the highlight when it truly leaves.
export function insideRect(e: DragEvent): boolean {
  const r = e.currentTarget.getBoundingClientRect();
  return e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
}

const numFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
export const fmt = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : numFmt.format(n);
export const fmtSigned = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : (n > 0 ? "+" : "") + numFmt.format(n);

// The budgeted income / cost split for one sheet. Only for this budget's own
// figures — anything involving a comparison goes through `sheetTotals` in
// lib/budget/compare.ts, which counts the other side's rows as well.
export function ccTotals(cc: BudgetCC, ev: Evaluated | undefined): Totals {
  let income = 0, cost = 0;
  for (const a of cc.accounts) {
    const t = ev?.accounts[`${sheetKey(cc)}:${a.accountCode}`] ?? 0;
    if (effectiveKind(a.accountCode, a.kindOverride) === "INCOME") income += t; else cost += t;
  }
  return { income, cost, result: income - cost };
}

/** One adjustment row as the sheet shows it: the amount, and which change it is. */
export interface AdjustmentRow {
  change: BudgetChange;
  amount: number;
}

/**
 * The adjustment rows to show under each account, keyed by account id. Only
 * changes still in force — a revoked one is history, and belongs in the history
 * view rather than in the figures.
 */
export function adjustmentRows(changes: BudgetChange[]): Map<string, AdjustmentRow[]> {
  const out = new Map<string, AdjustmentRow[]>();
  for (const change of changes) {
    if (!isActive(change)) continue;
    for (const e of change.entries) {
      const rows = out.get(e.accountId);
      if (rows) rows.push({ change, amount: e.amount });
      else out.set(e.accountId, [{ change, amount: e.amount }]);
    }
  }
  return out;
}

/**
 * How much the changes in force have moved each sheet's result, keyed the way
 * the Rambudget knows a sheet (`compareKey`) rather than by id — that table's
 * rows come out of the comparison join, so a row may belong to another budget
 * entirely, and those simply aren't in this map.
 *
 * A transfer nets to zero across its result unit but not necessarily
 * within one sheet, so a sheet may well show a figure here while the result unit
 * subtotal below it shows none. That is the honest picture: the money did move.
 */
export function changeImpactBySheet(budget: Budget): Map<string, number> {
  const sheetOfAccount = new Map<string, string>();
  for (const cc of budget.costCenters) {
    for (const a of cc.accounts) {
      sheetOfAccount.set(a.id, compareKey(cc));
    }
  }
  const kindOfAccount = new Map(
    budget.costCenters.flatMap((cc) =>
      cc.accounts.map((a) => [a.id, effectiveKind(a.accountCode, a.kindOverride)] as const),
    ),
  );

  const out = new Map<string, number>();
  for (const change of budget.changes) {
    if (!isActive(change)) continue;
    for (const e of change.entries) {
      const key = sheetOfAccount.get(e.accountId);
      const kind = kindOfAccount.get(e.accountId);
      if (!key || !kind) continue; // an account this budget no longer holds
      out.set(key, (out.get(key) ?? 0) + resultImpact(kind, e.amount));
    }
  }
  return out;
}

// Bucket by result unit, preserving the incoming order of both the buckets and
// their contents. Shared by the sidebar (which groups cost centres) and the
// Rambudget table (which groups pre-totalled rows), hence the accessor.
export function groupByResultUnit<T>(items: T[], resultUnitOf: (x: T) => string | null): { resultUnit: string; items: T[] }[] {
  const groups: { resultUnit: string; items: T[] }[] = [];
  const byName = new Map<string, T[]>();
  for (const it of items) {
    const com = resultUnitOf(it) || OTHER;
    let bucket = byName.get(com);
    if (!bucket) { bucket = []; byName.set(com, bucket); groups.push({ resultUnit: com, items: bucket }); }
    bucket.push(it);
  }
  return groups;
}

// Colour a "Utfall − Budget" difference so green always reads as favourable.
// For income-like rows spending past budget (a positive diff) is good; for
// cost-like rows it's the reverse. Result rows are income-like (higher = better).
export function diffClass(diff: number, incomeLike: boolean): string {
  if (diff === 0) return "text-muted";
  const good = incomeLike ? diff > 0 : diff < 0;
  return good ? "text-success" : "text-danger";
}
