// Expression evaluator for budget line items and variables.
// No leading "=" is a literal number, "=..." a formula (numbers, + - * /, parentheses, variables,
// `account(CC_CODE, ACCT_CODE)`, sheet totals `income(CC)` / `cost(CC)` / `result(CC)`, cell refs `@L<lineItemId>:<fieldKey>`, see lib/budget/grid.ts), anything else is NaN.
// Fixed-point iteration resolves chains across cost centres. Circular dependencies hit a pass limit and give NaN.
// A formula is read whole or not at all, and a cell that did not resolve poisons its readers instead of counting
// as zero, so an account total is either right or flagged in `badAccounts`.

import { effectiveKind, type AccountKind } from "@/lib/budget";
import { sekToOre } from "@/lib/domain/money";

// Units: the language is not all money (a headcount, `67%`), so arithmetic happens in kronor and money results
// are rounded to integer öre when a row's amount is settled, then summed as integers.
type AccountTotals = Map<string, number>; // "CC_CODE:ACCT_CODE" → öre
/** Variable values, in whatever the variable means: kronor, a count, a ratio. */
type VarValues = Map<string, number>;
/** Working values for cell references, in kronor (rounded to öre precision). */
type CellValues = Map<string, number>;
/** Every "CC_CODE:ACCT_CODE" the budget actually holds, rows or no rows. */
type KnownAccounts = ReadonlySet<string>;

// "bad" is a character with no meaning. `parseAtom` answers NaN for it, so `=350 kr` is not read as 350.
type TokKind =
  "num" | "id" | "ref" | "acct" | "total" | "op" | "lparen" | "rparen" | "comma" | "bad" | "eof";
interface Tok {
  kind: TokKind;
  val: string;
}

// Any letter may start or continue a name, not just A-Z: variable names are never validated, so ÅRSAVGIFT must lex as one name.
const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;

// A sheet's totals: what its income accounts sum to, its cost accounts, and the difference.
const TOTAL_FNS = new Set(["income", "cost", "result"]);
type TotalFn = "income" | "cost" | "result";

/** The argument text of an `account(…)` starting at `from`, or null if no call follows. `end` is where lexing resumes. */
function acctArgs(src: string, from: number): { raw: string; end: number } | null {
  let j = from;
  while (j < src.length && /\s/.test(src[j])) j++;
  if (src[j] !== "(") return null;
  const close = src.indexOf(")", j);
  if (close === -1) return null;
  return { raw: src.slice(j + 1, close), end: close + 1 };
}

function tokenise(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = "";
      while (i < src.length && /[0-9._]/.test(src[i])) num += src[i++];
      toks.push({ kind: "num", val: num.replace(/_/g, "") });
    } else if (ch === "@") {
      i++;
      let ref = "";
      while (i < src.length && /[A-Za-z0-9:]/.test(src[i])) ref += src[i++];
      toks.push({ kind: "ref", val: ref });
    } else if (ID_START.test(ch)) {
      let id = "";
      while (i < src.length && ID_PART.test(src[i])) id += src[i++];
      // account(CC_CODE, ACCT_CODE): arguments are opaque codes taken whole, since a code may hold Å/Ä/Ö or a hyphen and lead with a digit.
      const fn = id.toLowerCase();
      const args = fn === "account" || TOTAL_FNS.has(fn) ? acctArgs(src, i) : null;
      if (args && fn === "account") {
        toks.push({ kind: "acct", val: args.raw });
        i = args.end;
      } else if (args) {
        toks.push({ kind: "total", val: `${fn}|${args.raw.trim()}` });
        i = args.end;
      } else {
        toks.push({ kind: "id", val: id });
      }
    } else if ("+-*/×÷".includes(ch)) {
      // Accept the typographic ×/÷ as aliases for * and /.
      const op = ch === "×" ? "*" : ch === "÷" ? "/" : ch;
      toks.push({ kind: "op", val: op });
      i++;
    } else if (ch === "(") {
      toks.push({ kind: "lparen", val: "(" });
      i++;
    } else if (ch === ")") {
      toks.push({ kind: "rparen", val: ")" });
      i++;
    } else if (ch === ",") {
      toks.push({ kind: "comma", val: "," });
      i++;
    } else {
      toks.push({ kind: "bad", val: ch });
      i++;
    }
  }
  toks.push({ kind: "eof", val: "" });
  return toks;
}

/** Everything a formula may read. Unresolved cells are stored as 0 so the iteration settles; `badCells` says which zeros are failures. */
interface EvalCtx {
  vars: VarValues;
  accounts: AccountTotals;
  cells: CellValues;
  badCells: Set<string>;
  known: KnownAccounts;
  /** Income and cost per sheet code, in öre. */
  sheets: Map<string, Record<AccountKind, number>>;
  /** "CODE:INCOME" / "CODE:COST" for a side with a row that did not resolve. */
  badSides: Set<string>;
  /** The row being evaluated, so it cannot read a total it is part of. Unset for variables. */
  self?: { sheet: string; kind: AccountKind };
}

function evalExpr(src: string, ctx: EvalCtx): number {
  const { vars, accounts, cells, badCells, known, sheets, badSides, self } = ctx;
  const toks = tokenise(src);
  let pos = 0;

  const peek = () => toks[pos];
  const consume = () => toks[pos++];

  function parseExpr(): number {
    return parseAddSub();
  }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek().kind === "op" && (peek().val === "+" || peek().val === "-")) {
      const op = consume().val;
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek().kind === "op" && (peek().val === "*" || peek().val === "/")) {
      const op = consume().val;
      const right = parseUnary();
      left = op === "*" ? left * right : right === 0 ? NaN : left / right;
    }
    return left;
  }

  function parseUnary(): number {
    if (peek().kind === "op" && peek().val === "-") {
      consume();
      return -parseAtom();
    }
    return parseAtom();
  }

  function parseAtom(): number {
    const t = peek();
    if (t.kind === "num") {
      consume();
      return parseFloat(t.val);
    }
    if (t.kind === "ref") {
      consume();
      // val is "L<lineItemId>:<fieldKey>", the cell map is keyed "<lineItemId>:<fieldKey>".
      const key = t.val.startsWith("L") ? t.val.slice(1) : t.val;
      // An unresolved cell makes this formula unresolved too (see EvalCtx).
      if (badCells.has(key)) return NaN;
      const v = cells.get(key);
      return v !== undefined ? v : NaN;
    }
    if (t.kind === "lparen") {
      consume();
      const v = parseExpr();
      if (peek().kind !== "rparen") return NaN;
      consume();
      return v;
    }
    if (t.kind === "acct") {
      consume();
      const [cc = "", acct = ""] = t.val.split(",", 2).map((s) => s.trim());
      const key = `${cc}:${acct}`;
      const total = accounts.get(key);
      // Back to kronor: totals are kept in öre, but a formula does its arithmetic in kronor.
      if (total !== undefined) return total / 100;
      // An account the budget holds with no rows is zero. One it does not hold is NaN ("fel"), like an unknown variable.
      return known.has(key) ? 0 : NaN;
    }
    if (t.kind === "total") {
      consume();
      const [fn, code] = t.val.split("|", 2) as [TotalFn, string];
      const sides: AccountKind[] =
        fn === "income" ? ["INCOME"] : fn === "cost" ? ["COST"] : ["INCOME", "COST"];
      // A row cannot read the total it is counted in. Said at once rather than left to the pass limit.
      if (self && self.sheet === code && sides.includes(self.kind)) return NaN;
      const totals = sheets.get(code);
      if (!totals || sides.some((k) => badSides.has(`${code}:${k}`))) return NaN;
      const ore =
        fn === "income" ? totals.INCOME : fn === "cost" ? totals.COST : totals.INCOME - totals.COST;
      return ore / 100;
    }
    if (t.kind === "id") {
      consume();
      const v = vars.get(t.val);
      return v !== undefined ? v : NaN;
    }
    return NaN;
  }

  const result = parseExpr();
  // Everything or nothing: trailing unparsed input (`=350 kr`, `=100 200`) is an error, not a short figure.
  if (peek().kind !== "eof") return NaN;
  return Number.isFinite(result) ? result : NaN;
}

function evalCell(raw: string | null | undefined, ctx: EvalCtx): number {
  const s = (raw ?? "").trim();
  if (!s) return NaN;
  if (s.startsWith("=")) return evalExpr(s.slice(1), ctx);
  // A trailing % is a fraction: "67%" → 0.67.
  if (s.endsWith("%")) {
    const p = Number(s.slice(0, -1).replace(/[\s_]/g, "").replace(",", "."));
    return Number.isFinite(p) ? p / 100 : NaN;
  }
  const n = Number(s.replace(/_/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

export interface LineItemInput {
  id: string;
  accountKey: string; // "CC_CODE:ACCT_CODE"
  expression: string; // the Belopp cell, a literal number or "=…" formula
  // Per-line values for user-defined columns: { [columnId]: string }.
  values?: Record<string, string> | null;
}

export interface VariableInput {
  name: string;
  expression: string;
}

// One editorial adjustment netted per account (lib/budget/changes.ts), added after the rows are summed so `account(CC, ACCT)` references read the figure in force.
export interface AdjustmentInput {
  accountKey: string; // "CC_CODE:ACCT_CODE"
  amount: number; // öre, signed in the account's own orientation
}

export interface EvalResult {
  /** Variable name → its value, in whatever it means (kronor, a count, a ratio). */
  vars: VarValues;
  accounts: AccountTotals; // "CC:ACCT" → sum of its rows, in öre
  lineItems: Map<string, number>; // lineItem.id → the row's amount, in öre
  /** Reference values in kronor, the working unit, not an output. See Units. */
  cells: CellValues;
  badLineItems: string[]; // ids whose cell didn't resolve (formula error)
  badVariables: string[]; // variable names that didn't resolve
  /** Account keys ("CC:ACCT") whose total is missing a row. The total is still the sum of the rows that resolved. */
  badAccounts: string[];
  errors: string[]; // human-readable warnings (circular etc.)
}

export function evaluate(
  variables: VariableInput[],
  lineItems: LineItemInput[],
  // x1…x6 values are evaluated into cells so other formulas can reference them.
  extraColumnKeys: string[] = [],
  // Editorial adjustments folded into the account totals.
  adjustments: AdjustmentInput[] = [],
  // Every account the budget holds, rows or not: tells an empty account (zero) from a missing one (error). Omitted means only accounts with rows resolve.
  knownAccounts: Iterable<string> = [],
  maxPasses = 8,
): EvalResult {
  const known: KnownAccounts = new Set(knownAccounts);
  const vars: VarValues = new Map();
  const accounts: AccountTotals = new Map();
  const cells: CellValues = new Map();
  const badCells = new Set<string>();
  const liValues: Map<string, number> = new Map();
  const errors: string[] = [];
  const sheets = new Map<string, Record<AccountKind, number>>();
  const badSides = new Set<string>();
  const ctx: EvalCtx = { vars, accounts, cells, badCells, known, sheets, badSides };
  const splitKey = (accountKey: string) => {
    const at = accountKey.lastIndexOf(":");
    return { sheet: accountKey.slice(0, at), kind: effectiveKind(accountKey.slice(at + 1)) };
  };
  // Every sheet the budget holds reads as zero until its rows say otherwise.
  const zeroSheets = () => {
    sheets.clear();
    for (const key of [...known, ...lineItems.map((li) => li.accountKey)]) {
      sheets.set(splitKey(key).sheet, { INCOME: 0, COST: 0 });
    }
  };
  zeroSheets();

  let pass = 0;
  let stable = false;

  while (!stable && pass < maxPasses) {
    pass++;
    const prevVars = new Map(vars);
    const prevAccts = new Map(accounts);
    // Cells are part of the convergence test too, or an unsettled chain would be declared stable.
    const prevCells = new Map(cells);
    const prevBad = new Set(badCells);
    const prevSides = new Set(badSides);

    // Step 1: evaluate line items + their cells using current var/account/cell values
    badCells.clear();
    for (const li of lineItems) {
      ctx.self = splitKey(li.accountKey);
      const kr = evalCell(li.expression, ctx);
      // The rounding boundary: a row's Belopp becomes integer öre here, once.
      const ore = Number.isFinite(kr) ? sekToOre(kr) : 0;
      liValues.set(li.id, ore);
      // The cell map keeps finite numbers (0 for unresolved) so the fixed point settles; `badCells` marks the failures.
      // Stored in kronor from the rounded öre, so a formula reads the figure the sheet shows.
      const key = `${li.id}:expression`;
      cells.set(key, ore / 100);
      if (!Number.isFinite(kr)) badCells.add(key);
      for (const colId of extraColumnKeys) {
        const cv = evalCell(li.values?.[colId], ctx);
        const colKey = `${li.id}:${colId}`;
        cells.set(colKey, Number.isFinite(cv) ? cv : 0);
        // An empty general column is empty, not broken.
        if (!Number.isFinite(cv) && (li.values?.[colId] ?? "").trim()) badCells.add(colKey);
      }
    }
    ctx.self = undefined;

    // Step 2: sum rows into account totals, then add adjustments by key: a förflyttning may fund an account the sheet never budgeted.
    // Integer öre on both sides, so the addition is exact.
    accounts.clear();
    for (const li of lineItems) {
      const cur = accounts.get(li.accountKey) ?? 0;
      accounts.set(li.accountKey, cur + (liValues.get(li.id) ?? 0));
    }
    for (const adj of adjustments) {
      accounts.set(adj.accountKey, (accounts.get(adj.accountKey) ?? 0) + adj.amount);
    }

    // Sheet totals from the account totals, and which sides are missing a row.
    zeroSheets();
    for (const [key, ore] of accounts) {
      const { sheet, kind } = splitKey(key);
      const totals = sheets.get(sheet) ?? { INCOME: 0, COST: 0 };
      totals[kind] += ore;
      sheets.set(sheet, totals);
    }
    badSides.clear();
    for (const li of lineItems) {
      if (!badCells.has(`${li.id}:expression`)) continue;
      const { sheet, kind } = splitKey(li.accountKey);
      badSides.add(`${sheet}:${kind}`);
    }

    // Step 3: evaluate variables in declaration order (later vars can ref earlier)
    for (const v of variables) {
      const val = evalCell(v.expression, ctx);
      vars.set(v.name, Number.isFinite(val) ? val : 0);
    }

    // A map that lost a key between passes is not stable, so compare sizes too.
    const same = <V>(now: Map<string, V>, before: Map<string, V>) =>
      now.size === before.size && [...now.entries()].every(([k, v]) => before.get(k) === v);
    stable =
      same(vars, prevVars) &&
      same(accounts, prevAccts) &&
      same(cells, prevCells) &&
      badCells.size === prevBad.size &&
      [...badCells].every((k) => prevBad.has(k)) &&
      badSides.size === prevSides.size &&
      [...badSides].every((k) => prevSides.has(k));
  }

  // Final pass to flag cells/variables that don't resolve (after convergence).
  const badLineItems: string[] = [];
  for (const li of lineItems) {
    ctx.self = splitKey(li.accountKey);
    const value = evalCell(li.expression, ctx);
    if (!Number.isFinite(value)) badLineItems.push(li.id);
  }
  ctx.self = undefined;
  const badVariables: string[] = [];
  for (const v of variables) {
    const val = evalCell(v.expression, ctx);
    if (!Number.isFinite(val)) badVariables.push(v.name);
  }

  // Accounts where at least one row did not resolve, so the sheet can mark the partial sum.
  const badAccounts = [
    ...new Set(lineItems.filter((li) => badLineItems.includes(li.id)).map((li) => li.accountKey)),
  ];

  if (!stable) {
    // A code, not a sentence. The screen wording lives in `budget.eval`.
    errors.push("circular");
  }

  return {
    vars,
    accounts,
    lineItems: liValues,
    cells,
    badLineItems,
    badVariables,
    badAccounts,
    errors,
  };
}
