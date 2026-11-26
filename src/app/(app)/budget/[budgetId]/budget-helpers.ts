// Pure helpers + constants shared across the budget sheets.
import { effectiveKind, sheetKey } from "@/lib/budget";
import { isActive, resultImpact } from "@/lib/budget/changes";
import { compareKey, type Totals } from "@/lib/budget/compare";
import type { Budget, BudgetCC, BudgetChange, Evaluated } from "./budget-types";

export const RAMBUDGET = "__rambudget__";
export const VARS = "__vars__";
export const CHANGES = "__changes__";
// The open sheet in the address: `?view=frame` for the Rambudget, `?sheet=` for the detail
// view's sheet (a cost-centre sheet by id, or one of these words). Kept while the Rambudget is
// open, so the toggle returns to the same sheet after a refresh too.
const SHEET_WORDS: Record<string, string> = { [VARS]: "variables", [CHANGES]: "changes" };

export function sheetFromUrl(sheet: string | undefined): string | null {
  if (!sheet) return null;
  return Object.entries(SHEET_WORDS).find(([, w]) => w === sheet)?.[0] ?? sheet;
}

/** The search string for `selected`, keeping whatever else the address carries. */
export function sheetSearch(current: string, selected: string): string {
  const q = new URLSearchParams(current);
  if (selected === RAMBUDGET) q.set("view", "frame");
  else {
    q.delete("view");
    q.set("sheet", SHEET_WORDS[selected] ?? selected);
  }
  return q.toString();
}

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

// A formula string (leading "=", row references as #5) as a readable equation without the "=". A
// plain literal is returned unchanged.
export function prettyFormula(formulaText: string): string {
  const s = formulaText.trim();
  if (!s.startsWith("=")) return s;
  return outsideAccountCalls(s.slice(1), (part) => part.replace(/(\d)\.(\d)/g, "$1,$2"))
    .replace(/\*/g, " × ")
    .replace(/\//g, " ÷ ")
    .replace(/\+/g, " + ")
    .replace(/([\w)%.])-([\w(])/g, "$1 − $2") // binary minus only (keep unary/negatives)
    .replace(/\s+/g, " ")
    .trim();
}

// `account(CC, KONTO)` is the one place a comma separates arguments, so a decimal comma is
// told apart from it by running `fn` only on the text between those calls.
function outsideAccountCalls(text: string, fn: (part: string) => string): string {
  return text
    .split(/(account\s*\([^)]*\))/i)
    .map((part, i) => (i % 2 ? part : fn(part)))
    .join("");
}

/**
 * A formula as it is edited: what would be typed, not prettyFormula's spaced ×/÷/−, so the
 * caret moves through no extra spaces ("2*4", "#6-#7", "2,5*3"). Without the "=" when the
 * entry rules put it back (normalizeFormula), with it when they would not ("=5").
 */
export function editFormula(formulaText: string): string {
  const s = formulaText.trim();
  if (!s.startsWith("=")) return s;
  const body = outsideAccountCalls(s.slice(1), (part) => part.replace(/(\d)\.(\d)/g, "$1,$2"));
  return normalizeFormula(body) === s ? body : "=" + body;
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
      if (/[\d)]/.test(prev) && /[\d(A-Za-z_#]/.test(next)) {
        out += "*";
        continue;
      }
    }
    out += c;
  }
  return out;
}

// What the user typed to what we store. A leading "=" is honoured; a bare entry with an
// operator, identifier or row reference (#5) becomes a formula; a plain number or percentage
// stays literal.
export function normalizeFormula(raw: string): string {
  const s = raw.trim();
  if (s === "") return s;
  const lead = s.startsWith("=");
  // Canonical stored form: * and / for ×/÷ and a numeric 'x', - for the typographic minus
  // prettyFormula shows, a decimal point for a decimal comma ("12,5"), no spaces around
  // operators (keep commas in account(CC, ACCT)). A focus then blur with no edit stays a no-op:
  // what prettyFormula shows comes back as what was stored.
  const body = normalizeMul(lead ? s.slice(1) : s)
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/\s*([*/+\-()])\s*/g, "$1")
    .trim();
  const decimal = (t: string) =>
    outsideAccountCalls(t, (part) => part.replace(/(\d),(\d)/g, "$1.$2"));
  if (lead) return "=" + decimal(body);
  const numeric = /^-?[\d\s._]+%?$/.test(body.replace(",", "."));
  if (numeric) return body;
  if (/[+\-*/()#]/.test(body) || /[A-Za-z_]/.test(body)) return "=" + decimal(body);
  return body;
}

// Whole kronor bare, anything with öre to two decimals ("700", "12,50"), as money is written.
const wholeFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const oreFmt = new Intl.NumberFormat("sv-SE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const kronor = (ore: number) => (ore % 100 === 0 ? wholeFmt : oreFmt).format(ore / 100);

/** A money amount for the sheet: öre in, kronor out (to the öre). Non-money numbers (headcount, share) use `fmtScalar`. */
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
  ore === undefined || Number.isNaN(ore) ? "" : kronor(ore);
export const fmtSigned = (ore: number | undefined) =>
  ore === undefined || Number.isNaN(ore) ? "" : (ore > 0 ? "+" : "") + kronor(ore);

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

/**
 * The order sheets are listed in, the sidebar and the Rambudget alike: by cost-centre code,
 * `numeric` so AKTU2 sorts before AKTU10, then sheets with no cost centre, by name ("sv"
 * collation). Not the order they were added in, so a new SEX06 lands after SEX05.
 */
export function compareSheets(
  a: { code: string | null; name: string },
  b: { code: string | null; name: string },
): number {
  if (a.code && b.code) return a.code.localeCompare(b.code, "sv", { numeric: true });
  if (a.code) return -1;
  if (b.code) return 1;
  return a.name.localeCompare(b.name, "sv");
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

/**
 * The Avvikelse column. Against the outcome it is Utfall minus Budget (how the year went against
 * the plan). Against another budget it is this budget minus that one, so the difference speaks
 * for the budget being edited: more income or less cost here is green.
 */
export function compareDiff(own: number, other: number, vsActuals: boolean): number {
  return vsActuals ? other - own : own - other;
}

// Colour a difference (compareDiff) so green is favourable: positive is good for
// income-like rows (and result rows), the reverse for cost-like rows.
export function diffClass(diff: number, incomeLike: boolean): string {
  if (diff === 0) return "text-muted";
  const good = incomeLike ? diff > 0 : diff < 0;
  return good ? "text-success" : "text-danger";
}

/**
 * Whether a row moved to `moved`'s place in `order` (an account's lines after the move) lands
 * between the first and last of `held` there: slotted into the middle of what was copied.
 */
export function landsInside(order: readonly string[], moved: string, held: readonly string[]) {
  const at = order.flatMap((id, i) => (id !== moved && held.includes(id) ? [i] : []));
  const i = order.indexOf(moved);
  return at.length > 0 && i > at[0] && i < at[at.length - 1];
}
