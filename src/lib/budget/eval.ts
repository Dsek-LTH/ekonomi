// Expression evaluator for budget line items and variables.
//
// A cell is read like a spreadsheet cell:
//   • no leading "="           → a literal number  (350  →  350)
//   • leading "="              → a formula         (=350*2  →  700)
//   • anything else (text)     → an error (NaN)
//
// Formula syntax (after the "="):
//   number literals:  1500  /  2_000.50
//   arithmetic:       +  -  *  /  (grouped with parentheses)
//   variable refs:    MEMBERS  /  TICKET_PRICE
//   account totals:   account(CC_CODE, ACCT_CODE)
//   cell refs:        @L<lineItemId>:<fieldKey>   (the row-bound form of an A1
//                     reference like =E5; see lib/budget/grid.ts)
//
// Evaluation uses fixed-point iteration so references that chain through
// variables, account totals and other cells resolve across cost centres.
// Circular dependencies are caught by a pass limit and surfaced as NaN.

export type AccountTotals = Map<string, number>; // "CC_CODE:ACCT_CODE" → SEK
export type VarValues    = Map<string, number>;  // variable name → SEK
export type CellValues   = Map<string, number>;  // "<lineItemId>:<fieldKey>" → SEK
/** Every "CC_CODE:ACCT_CODE" the budget actually holds, rows or no rows. */
export type KnownAccounts = ReadonlySet<string>;

type TokKind = "num" | "id" | "ref" | "acct" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Tok { kind: TokKind; val: string }

// What may start / continue a name. Any letter, not just A–Z: variable names are
// typed by hand and never validated (see POST /api/budgets/[id]/variables), so a
// budget is free to call one ÅRSAVGIFT. Lexing that as `RSAVGIFT` would not fail
// — it would resolve to a different, missing variable.
const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;

/**
 * The parenthesised argument text of an `account(…)` starting at `from` (the
 * position just past the name), or null when what follows isn't a call. `end` is
 * where lexing resumes, past the closing paren.
 */
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
    if (/\s/.test(ch)) { i++; continue; }
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      let num = "";
      while (i < src.length && /[0-9._]/.test(src[i])) num += src[i++];
      toks.push({ kind: "num", val: num.replace(/_/g, "") });
    } else if (ch === "@") {
      // Row-bound cell reference: @L<lineItemId>:<fieldKey>
      i++;
      let ref = "";
      while (i < src.length && /[A-Za-z0-9:]/.test(src[i])) ref += src[i++];
      toks.push({ kind: "ref", val: ref });
    } else if (ID_START.test(ch)) {
      let id = "";
      while (i < src.length && ID_PART.test(src[i])) id += src[i++];
      // account(CC_CODE, ACCT_CODE): the arguments are opaque codes, not
      // expressions, so they are taken whole rather than tokenised. A
      // cost-centre code may hold Å/Ä/Ö or a hyphen and may lead with a digit
      // (the format the settings screen accepts — see POST /api/cost-centers),
      // none of which survive being read as an identifier: `account(NÄRU, 3010)`
      // lexed as the ids `N` and `RU` and then looked up the account "N:RU",
      // which of course was not there.
      const args = id.toLowerCase() === "account" ? acctArgs(src, i) : null;
      if (args) {
        toks.push({ kind: "acct", val: args.raw });
        i = args.end;
      } else {
        toks.push({ kind: "id", val: id });
      }
    } else if ("+-*/×÷".includes(ch)) {
      // Accept the typographic ×/÷ as aliases for * and /.
      const op = ch === "×" ? "*" : ch === "÷" ? "/" : ch;
      toks.push({ kind: "op", val: op }); i++;
    } else if (ch === "(") {
      toks.push({ kind: "lparen", val: "(" }); i++;
    } else if (ch === ")") {
      toks.push({ kind: "rparen", val: ")" }); i++;
    } else if (ch === ",") {
      toks.push({ kind: "comma", val: "," }); i++;
    } else {
      i++; // skip unknown characters
    }
  }
  toks.push({ kind: "eof", val: "" });
  return toks;
}

function evalExpr(
  src: string,
  vars: VarValues,
  accounts: AccountTotals,
  cells: CellValues,
  known: KnownAccounts,
): number {
  const toks = tokenise(src);
  let pos = 0;

  const peek = () => toks[pos];
  const consume = () => toks[pos++];

  function parseExpr(): number { return parseAddSub(); }

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
      // val is "L<lineItemId>:<fieldKey>"; the cell map is keyed
      // "<lineItemId>:<fieldKey>".
      const key = t.val.startsWith("L") ? t.val.slice(1) : t.val;
      const v = cells.get(key);
      return v !== undefined ? v : NaN;
    }
    if (t.kind === "lparen") {
      consume();
      const v = parseExpr();
      if (peek().kind === "rparen") consume();
      return v;
    }
    // Built-in function: account(CC_CODE, ACCT_CODE)
    if (t.kind === "acct") {
      consume();
      const [cc = "", acct = ""] = t.val.split(",", 2).map((s) => s.trim());
      const key = `${cc}:${acct}`;
      const total = accounts.get(key);
      if (total !== undefined) return total;
      // Nothing summed into it. An account the budget holds but put no rows on
      // is empty, and empty is zero — that is a true answer, not a broken
      // formula. An account it doesn't hold at all is a reference to something
      // that isn't there, which is the same failure as naming a variable that
      // doesn't exist and reads the same way: NaN, surfaced as "fel".
      return known.has(key) ? 0 : NaN;
    }
    if (t.kind === "id") {
      consume();
      // Variable reference
      const v = vars.get(t.val);
      return v !== undefined ? v : NaN;
    }
    return NaN;
  }

  const result = parseExpr();
  return Number.isFinite(result) ? result : NaN;
}

// A spreadsheet cell: literal number unless it starts with "=", in which case
// the rest is a formula. Empty / non-numeric text → NaN.
function evalCell(
  raw: string | null | undefined,
  vars: VarValues,
  accounts: AccountTotals,
  cells: CellValues,
  known: KnownAccounts,
): number {
  const s = (raw ?? "").trim();
  if (!s) return NaN;
  if (s.startsWith("=")) return evalExpr(s.slice(1), vars, accounts, cells, known);
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
  expression: string; // the Belopp cell — a literal number or "=…" formula
  // Per-line values for user-defined columns: { [columnId]: string }.
  values?: Record<string, string> | null;
}

export interface VariableInput {
  name: string;
  expression: string;
}

// One editorial adjustment, already netted per account (see
// adjustmentsByAccount in lib/budget/changes.ts). These are decided amounts, not
// expressions: they are added to the account total after its rows are summed, so
// everything downstream — `account(CC, ACCT)` references included — reads the
// figure that is actually in force rather than the one that was adopted.
export interface AdjustmentInput {
  accountKey: string; // "CC_CODE:ACCT_CODE"
  amount: number;     // SEK, signed in the account's own orientation
}

export interface EvalResult {
  vars: VarValues;           // variable name → evaluated SEK value
  accounts: AccountTotals;   // "CC:ACCT" → sum of line items (SEK)
  lineItems: Map<string, number>; // lineItem.id → evaluated SEK value
  cells: CellValues;         // "<lineItemId>:<fieldKey>" → evaluated SEK value
  badLineItems: string[];    // ids whose cell didn't resolve (formula error)
  badVariables: string[];    // variable names that didn't resolve
  errors: string[];          // human-readable warnings (circular etc.)
}

export function evaluate(
  variables: VariableInput[],
  lineItems: LineItemInput[],
  // The general columns (x1…x6) whose per-line values are evaluated into cells
  // so they can be referenced (numbers/percentages) by other formulas.
  extraColumnKeys: string[] = [],
  // Editorial adjustments to fold into the account totals. Empty for a budget
  // that has none, which is every budget until it is locked.
  adjustments: AdjustmentInput[] = [],
  // Every account the budget holds, whether or not anything was posted to it —
  // what tells an empty account (zero) apart from one that isn't there (an
  // error). A caller that passes nothing gets the strict reading, where only an
  // account with rows resolves.
  knownAccounts: Iterable<string> = [],
  maxPasses = 8,
): EvalResult {
  const known: KnownAccounts = new Set(knownAccounts);
  const vars: VarValues     = new Map();
  const accounts: AccountTotals = new Map();
  const cells: CellValues   = new Map();
  const liValues: Map<string, number> = new Map();
  const errors: string[] = [];

  let pass = 0;
  let stable = false;

  while (!stable && pass < maxPasses) {
    pass++;
    const prevVars    = new Map(vars);
    const prevAccts   = new Map(accounts);

    // Step 1: evaluate line items + their cells using current var/account/cell values
    for (const li of lineItems) {
      const value = evalCell(li.expression, vars, accounts, cells, known);
      liValues.set(li.id, Number.isFinite(value) ? value : 0);
      // Cell map keeps finite numbers (0 for unresolved) so the fixed point
      // stays stable; the bad-cell set below tracks the actual errors. Keyed by
      // field so refs survive column reorders.
      cells.set(`${li.id}:expression`, Number.isFinite(value) ? value : 0);
      for (const colId of extraColumnKeys) {
        const cv = evalCell(li.values?.[colId], vars, accounts, cells, known);
        cells.set(`${li.id}:${colId}`, Number.isFinite(cv) ? cv : 0);
      }
    }

    // Step 2: sum line items into account totals, then add what has been decided
    // since. An account may hold nothing but an adjustment — a förflyttning is
    // allowed to fund a post the sheet never budgeted for — so the adjustments
    // are added by key rather than only onto totals that already exist.
    accounts.clear();
    for (const li of lineItems) {
      const cur = accounts.get(li.accountKey) ?? 0;
      accounts.set(li.accountKey, cur + (liValues.get(li.id) ?? 0));
    }
    for (const adj of adjustments) {
      accounts.set(adj.accountKey, (accounts.get(adj.accountKey) ?? 0) + adj.amount);
    }

    // Step 3: evaluate variables in declaration order (later vars can ref earlier)
    for (const v of variables) {
      const val = evalCell(v.expression, vars, accounts, cells, known);
      vars.set(v.name, Number.isFinite(val) ? val : 0);
    }

    // Check convergence
    stable =
      [...vars.entries()].every(([k, v]) => prevVars.get(k) === v) &&
      [...accounts.entries()].every(([k, v]) => prevAccts.get(k) === v);
  }

  // Final pass to flag cells/variables that don't resolve (after convergence).
  const badLineItems: string[] = [];
  for (const li of lineItems) {
    const value = evalCell(li.expression, vars, accounts, cells, known);
    if (!Number.isFinite(value)) badLineItems.push(li.id);
  }
  const badVariables: string[] = [];
  for (const v of variables) {
    const val = evalCell(v.expression, vars, accounts, cells, known);
    if (!Number.isFinite(val)) badVariables.push(v.name);
  }

  if (!stable) {
    // A code, not a sentence — the screen wording lives in `budget.eval`.
    errors.push("circular");
  }

  return { vars, accounts, lineItems: liValues, cells, badLineItems, badVariables, errors };
}
