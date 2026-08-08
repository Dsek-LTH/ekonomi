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
//
// A formula is read whole or not at all. Anything the grammar above does not
// account for — a stray word, a character with no meaning, a group that is
// never closed — makes the whole cell an error rather than a number followed by
// something quietly discarded. The same rule holds for what a formula reads:
// a cell that did not resolve poisons the ones referring to it instead of
// standing in as a zero, so an account total is either right or visibly
// incomplete (`badAccounts`), never plausibly wrong.

// ── Units ─────────────────────────────────────────────────────────
//
// The figures this produces are money and come out as integer öre, like every
// other amount in the app. Getting there needs one distinction the rest of the
// codebase doesn't:
//
// The *language* is not all money. `MEDLEMMAR` is a headcount, `67%` is a
// ratio, and `=MEDLEMMAR*20` multiplies one by kronor to get kronor. Scale that
// whole value space by 100 and `67%` becomes `67`, and every formula built on a
// share is a hundred times too big. So the arithmetic below happens in kronor,
// where a scalar is a scalar, and öre is what the money *results* are expressed
// in — rounded the moment a row's amount is settled, and summed as integers
// from there.
//
// That is where the float drift actually was: not in one row's arithmetic, but
// in adding a hundred of them together and comparing the answer to something.
export type AccountTotals = Map<string, number>; // "CC_CODE:ACCT_CODE" → öre
/** Variable values, in whatever the variable means — kronor, a count, a ratio. */
export type VarValues    = Map<string, number>;
/** Working values for cell references, in kronor (rounded to öre precision). */
export type CellValues   = Map<string, number>;
/** Every "CC_CODE:ACCT_CODE" the budget actually holds, rows or no rows. */
export type KnownAccounts = ReadonlySet<string>;

// "bad" is a character the language has no meaning for. It used to be skipped
// silently, which made `=350 kr` evaluate to 350 — a formula that quietly drops
// half of itself and returns a confident number is worse than one that fails,
// because nobody goes looking for it. It is a token now, and `parseAtom`
// answers NaN for it like any other thing it cannot read.
type TokKind = "num" | "id" | "ref" | "acct" | "op" | "lparen" | "rparen" | "comma" | "bad" | "eof";
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
      toks.push({ kind: "bad", val: ch }); i++;
    }
  }
  toks.push({ kind: "eof", val: "" });
  return toks;
}

/**
 * Everything a formula may read, in one value.
 *
 * `badCells` is the part that is not simply "the numbers so far": a cell that
 * did not resolve is still *stored* as 0, because the fixed-point iteration
 * below needs a finite number to settle on. Reading that 0 as though it were an
 * answer is what let one broken row turn into a clean, wrong total three rows
 * down. So the zero stays for the iteration and this set is what a formula
 * actually consults.
 */
interface EvalCtx {
  vars: VarValues;
  accounts: AccountTotals;
  cells: CellValues;
  badCells: Set<string>;
  known: KnownAccounts;
}

function evalExpr(src: string, ctx: EvalCtx): number {
  const { vars, accounts, cells, badCells, known } = ctx;
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
      // A cell that did not resolve is not a zero to build on — see EvalCtx.
      // Reading one makes this formula unresolved too, which is what puts the
      // row that depends on a broken row into `badLineItems` beside it.
      if (badCells.has(key)) return NaN;
      const v = cells.get(key);
      return v !== undefined ? v : NaN;
    }
    if (t.kind === "lparen") {
      consume();
      const v = parseExpr();
      // An unclosed group is a formula someone is still halfway through
      // writing. It used to be closed for them at the end of the line, so
      // `=(1+2` quietly answered 3.
      if (peek().kind !== "rparen") return NaN;
      consume();
      return v;
    }
    // Built-in function: account(CC_CODE, ACCT_CODE)
    if (t.kind === "acct") {
      consume();
      const [cc = "", acct = ""] = t.val.split(",", 2).map((s) => s.trim());
      const key = `${cc}:${acct}`;
      const total = accounts.get(key);
      // Back to kronor: the totals are kept in öre so they can be summed
      // exactly, but a formula reading one is doing arithmetic in the unit the
      // sheet is written in.
      if (total !== undefined) return total / 100;
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
  // Everything, or nothing. Without this the parser stopped wherever it stopped
  // understanding and handed back what it had read so far: `=350 kr` was 350,
  // `=100 200` was 100, and neither said anything was wrong. A budget figure
  // that is confidently short by whatever came after the space is the one
  // failure this file exists to prevent.
  if (peek().kind !== "eof") return NaN;
  return Number.isFinite(result) ? result : NaN;
}

// A spreadsheet cell: literal number unless it starts with "=", in which case
// the rest is a formula. Empty / non-numeric text → NaN.
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
  amount: number;     // öre, signed in the account's own orientation
}

export interface EvalResult {
  /** Variable name → its value, in whatever it means (kronor, a count, a ratio). */
  vars: VarValues;
  accounts: AccountTotals;   // "CC:ACCT" → sum of its rows, in öre
  lineItems: Map<string, number>; // lineItem.id → the row's amount, in öre
  /** Reference values in kronor — the working unit, not an output. See Units. */
  cells: CellValues;
  badLineItems: string[];    // ids whose cell didn't resolve (formula error)
  badVariables: string[];    // variable names that didn't resolve
  /**
   * Account keys ("CC:ACCT") whose total is missing at least one row.
   *
   * The total itself is still the sum of the rows that *did* resolve, because a
   * sheet you cannot read is no help in finding the row to fix. This is what
   * says the figure is a partial one — without it an account holding a broken
   * row showed a total that looked entirely ordinary.
   */
  badAccounts: string[];
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
  const badCells            = new Set<string>();
  const liValues: Map<string, number> = new Map();
  const errors: string[] = [];
  const ctx: EvalCtx = { vars, accounts, cells, badCells, known };

  let pass = 0;
  let stable = false;

  while (!stable && pass < maxPasses) {
    pass++;
    const prevVars    = new Map(vars);
    const prevAccts   = new Map(accounts);
    // The cells are part of the fixed point too. Leaving them out of the
    // convergence test meant a chain of cell references that had not settled
    // could still be declared stable — the loop stopped, the numbers were
    // whatever the last pass happened to hold, and nothing reported "circular".
    const prevCells   = new Map(cells);
    const prevBad     = new Set(badCells);

    // Step 1: evaluate line items + their cells using current var/account/cell values
    badCells.clear();
    for (const li of lineItems) {
      const kr = evalCell(li.expression, ctx);
      // The rounding boundary. A row's Belopp is money, so this is where it
      // stops being an arithmetic result and becomes an amount — and it is
      // rounded once, here, rather than being carried at full float precision
      // into a sum of a hundred rows and rounded at the end.
      const ore = Number.isFinite(kr) ? Math.round(kr * 100) : 0;
      liValues.set(li.id, ore);
      // The cell map keeps finite numbers (0 for unresolved) so the fixed point
      // stays stable; `badCells` is what says which of those zeros are answers
      // and which are failures. Keyed by field so refs survive column reorders.
      //
      // Stored back in kronor, and from the *rounded* öre — so a formula
      // reading this row reads the figure the sheet shows, not one that differs
      // from it in the twelfth decimal.
      const key = `${li.id}:expression`;
      cells.set(key, ore / 100);
      if (!Number.isFinite(kr)) badCells.add(key);
      for (const colId of extraColumnKeys) {
        const cv = evalCell(li.values?.[colId], ctx);
        const colKey = `${li.id}:${colId}`;
        cells.set(colKey, Number.isFinite(cv) ? cv : 0);
        // An empty general-purpose column is empty, not broken: most rows fill
        // in none of the six, and flagging them would poison every formula that
        // reads across a row.
        if (!Number.isFinite(cv) && (li.values?.[colId] ?? "").trim()) badCells.add(colKey);
      }
    }

    // Step 2: sum line items into account totals, then add what has been decided
    // since. An account may hold nothing but an adjustment — a förflyttning is
    // allowed to fund a post the sheet never budgeted for — so the adjustments
    // are added by key rather than only onto totals that already exist.
    //
    // Integer öre on both sides, so this is exact addition. It used to add
    // kronor floats, where a hundred rows of 0.1 do not come to 10 and the
    // total a sheet showed was not quite the total of the rows above it.
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
      const val = evalCell(v.expression, ctx);
      vars.set(v.name, Number.isFinite(val) ? val : 0);
    }

    // Check convergence. A map that lost a key between passes is not stable
    // either, so the sizes are compared alongside the entries.
    const same = <V,>(now: Map<string, V>, before: Map<string, V>) =>
      now.size === before.size && [...now.entries()].every(([k, v]) => before.get(k) === v);
    stable =
      same(vars, prevVars) &&
      same(accounts, prevAccts) &&
      same(cells, prevCells) &&
      badCells.size === prevBad.size &&
      [...badCells].every((k) => prevBad.has(k));
  }

  // Final pass to flag cells/variables that don't resolve (after convergence).
  const badLineItems: string[] = [];
  for (const li of lineItems) {
    const value = evalCell(li.expression, ctx);
    if (!Number.isFinite(value)) badLineItems.push(li.id);
  }
  const badVariables: string[] = [];
  for (const v of variables) {
    const val = evalCell(v.expression, ctx);
    if (!Number.isFinite(val)) badVariables.push(v.name);
  }

  // An account is only as complete as the rows under it. The total already
  // holds the ones that resolved; this names the accounts where that is less
  // than all of them, so the sheet can mark the figure rather than present a
  // partial sum as the budgeted amount.
  const badAccounts = [
    ...new Set(
      lineItems.filter((li) => badLineItems.includes(li.id)).map((li) => li.accountKey),
    ),
  ];

  if (!stable) {
    // A code, not a sentence — the screen wording lives in `budget.eval`.
    errors.push("circular");
  }

  return { vars, accounts, lineItems: liValues, cells, badLineItems, badVariables, badAccounts, errors };
}
