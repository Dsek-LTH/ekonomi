// Pure helpers + constants shared across the budget sheets.
import { effectiveKind, sheetKey } from "@/lib/budget";
import { isActive, resultImpact } from "@/lib/budget/changes";
import { compareKey, type Totals } from "@/lib/budget/compare";
import type { Budget, BudgetCC, BudgetChange, Evaluated } from "./budget-types";

export const RAMBUDGET = "__rambudget__";
export const VARS = "__vars__";
export const CHANGES = "__changes__";
// Sentinels, not words: they share a namespace with result unit names and the screen
// resolves them through `budget.group.<key>`.
const OTHER = "__other__";
// Sheets with no cost centre yet: "not decided", a to-do, unlike OTHER ("no result unit").
const UNLINKED = "__unlinked__";

/** A group heading as it reads on screen. `t` is scoped to `budget.group`. */
export const resultUnitLabel = (resultUnit: string, t: (key: string) => string): string =>
  resultUnit === OTHER || resultUnit === UNLINKED ? t(resultUnit.replace(/__/g, "")) : resultUnit;

export const resultUnitOf = (cc: BudgetCC): string =>
  cc.costCenter ? cc.costCenter.resultUnit || OTHER : UNLINKED;

// The same for a sheet from a comparison, which may belong to another budget or to none. A
// detached sheet is matched on its label, giving its key the "@"/"#" (compareKey in
// lib/budget/compare.ts).
export const resultUnitOfSheet = (s: { key: string; resultUnit: string | null }): string =>
  /^[@#]/.test(s.key) ? UNLINKED : s.resultUnit || OTHER;

// Belopp cells hold the equation ("=2*TROJA_POLICY"), shown with typographic operators plus
// its result on the Belopp column. Entry is forgiving ("2x3x12" becomes a formula).

// A formula string (leading "=", A1 display form) as a readable equation without the "=". A
// plain literal is returned unchanged.
export function prettyFormula(formulaText: string): string {
  const s = formulaText.trim();
  if (!s.startsWith("=")) return s;
  return s
    .slice(1)
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
      // Never convert after a letter, so identifiers like MAXx stay intact.
      if (/[\d)]/.test(prev) && /[\d(A-Za-z_]/.test(next)) {
        out += "*";
        continue;
      }
    }
    out += c;
  }
  return out;
}

// What the user typed to what we store. A leading "=" is honoured; a bare entry with an
// operator or identifier becomes a formula; a plain number or percentage stays literal.
export function normalizeFormula(raw: string): string {
  const s = raw.trim();
  if (s === "") return s;
  const lead = s.startsWith("=");
  // Canonical stored form: * and / for ×/÷ and a numeric 'x', no spaces around operators (keep
  // commas in account(CC, ACCT)). A focus then blur with no edit stays a no-op.
  const body = normalizeMul(lead ? s.slice(1) : s)
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/\s*([*/+\-()])\s*/g, "$1")
    .trim();
  if (lead) return "=" + body;
  const numeric = /^-?[\d\s._]+%?$/.test(body.replace(",", "."));
  if (numeric) return body;
  if (/[+\-*/()]/.test(body) || /[A-Za-z_]/.test(body)) return "=" + body;
  return body;
}

const numFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });

/** A money amount for the sheet: öre in, whole kronor out. Non-money numbers (headcount, share) use `fmtScalar`. */
/**
 * What a formula cell shows when nobody is editing it: the placeholder for an empty cell, the
 * formula on a cell drawn as one, "fel" for a failed formula, on a wide screen the working and
 * answer ("2 × TROJA_POLICY = 700"), otherwise the answer. `value` is already formatted.
 */
export function formulaIdleText(cell: {
  raw: string;
  pretty: string;
  value: string;
  placeholder?: string;
  asFormula: boolean;
  bad?: boolean;
  compact: boolean;
}): string {
  if (cell.raw.trim() === "") return cell.placeholder ?? "";
  if (cell.asFormula) return cell.pretty || cell.raw;
  if (cell.bad) return "fel";
  if (cell.raw.trim().startsWith("=") && !cell.compact) return `${cell.pretty} = ${cell.value}`;
  return cell.value;
}

export const fmt = (ore: number | undefined) =>
  ore === undefined || Number.isNaN(ore) ? "" : numFmt.format(ore / 100);
export const fmtSigned = (ore: number | undefined) =>
  ore === undefined || Number.isNaN(ore) ? "" : (ore > 0 ? "+" : "") + numFmt.format(ore / 100);

/** A dimensionless value printed as it stands (headcount, ratio): no unit conversion, decimals kept. */
const scalarFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 4 });
export const fmtScalar = (n: number | undefined) =>
  n === undefined || Number.isNaN(n) ? "" : scalarFmt.format(n);

// The budgeted income/cost split for this budget's own figures. Comparisons go through
// `sheetTotals` in lib/budget/compare.ts, which counts the other side's rows too.
export function ccTotals(cc: BudgetCC, ev: Evaluated | undefined): Totals {
  let income = 0,
    cost = 0;
  for (const a of cc.accounts) {
    const t = ev?.accounts[`${sheetKey(cc)}:${a.accountCode}`] ?? 0;
    if (effectiveKind(a.accountCode) === "INCOME") income += t;
    else cost += t;
  }
  return { income, cost, result: income - cost };
}

export interface AdjustmentRow {
  change: BudgetChange;
  amount: number;
}

/** The adjustment rows to show under each account by account id. Only changes in force. */
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
 * How much the changes in force moved each sheet's result, keyed by `compareKey` (a joined
 * row may belong to another budget and is absent). A transfer nets to zero across its result
 * unit but not necessarily within one sheet.
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
      cc.accounts.map((a) => [a.id, effectiveKind(a.accountCode)] as const),
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

// Bucket by result unit, keeping incoming order. Shared by the sidebar and the Rambudget
// table, hence the accessor.
export function groupByResultUnit<T>(
  items: T[],
  resultUnitOf: (x: T) => string | null,
): { resultUnit: string; items: T[] }[] {
  const groups: { resultUnit: string; items: T[] }[] = [];
  const byName = new Map<string, T[]>();
  for (const it of items) {
    const com = resultUnitOf(it) || OTHER;
    let bucket = byName.get(com);
    if (!bucket) {
      bucket = [];
      byName.set(com, bucket);
      groups.push({ resultUnit: com, items: bucket });
    }
    bucket.push(it);
  }
  return groups;
}

// Colour a "Utfall - Budget" difference so green is favourable: positive is good for
// income-like rows (and result rows), the reverse for cost-like rows.
export function diffClass(diff: number, incomeLike: boolean): string {
  if (diff === 0) return "text-muted";
  const good = incomeLike ? diff > 0 : diff < 0;
  return good ? "text-success" : "text-danger";
}
