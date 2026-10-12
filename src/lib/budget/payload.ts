// One description of a budget as it crosses the wire.
//
// This used to be two. The loader typed its answer `Record<string, unknown>`
// with a comment saying the shape was described on the client instead, and the
// page bridged the two with `budget as unknown as Budget`. The reasoning (one
// description, on the side that consumes it) was right; what it got was no
// description at all on the side that *produces* it, so the largest payload in
// the app had nothing checking that the server sent what the client reads.
//
// So the description stays single and moves here, where both halves can import
// it: the loader returns it and the client consumes it, and a field that stops
// being sent stops compiling.
//
// Everything is plain JSON. Dates are ISO strings, not Date objects, because
// that is what a fetch delivers and the page has to hand the client the same
// shapes its own re-fetch will. See `getEvaluatedBudget`.
import type { ChangeKind } from "./changes";
import type { CompareSheet } from "./compare";
import type { EvalResult } from "./eval";

export interface LineItem {
  id: string;
  description: string;
  /** The Belopp cell: a literal number or "=…" formula. */
  expression: string;
  sortOrder: number;
  /** Per-line values for the six general columns, keyed x1…x6. */
  values: Record<string, string>;
  /** The "antal × á-pris" form, when the row is written that way. */
  quantity: string | null;
  unitPrice: string | null;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string };
}

export interface Account {
  id: string;
  accountCode: string;
  accountName: string;
  lineItems: LineItem[];
  comments: Comment[];
}

/**
 * One sheet in the budget. `costCenter` is null while the sheet isn't linked to
 * one (a fresh clone, or a budget drafted before the cost centre existed) and
 * `label` is what it's called until it is. See BudgetCostCenter in
 * schema.prisma; `sheetKey`/`sheetName` in lib/budget resolve the two cases.
 */
export interface BudgetCC {
  id: string;
  sortOrder: number;
  label: string | null;
  costCenter: { id: string; code: string; name: string; resultUnit: string | null } | null;
  accounts: Account[];
}

export interface Variable {
  id: string;
  name: string;
  expression: string;
  sortOrder: number;
}

/** One account's share of a change. See BudgetChange in schema.prisma. */
export interface ChangeEntry {
  id: string;
  accountId: string;
  amount: number;
}

export interface BudgetChange {
  id: string;
  /** Running number within the budget: "avsteg #4". */
  seq: number;
  kind: ChangeKind;
  reason: string;
  createdAt: string;
  createdBy: { name: string };
  // Set together when revoked: it stops counting towards the figures and stays
  // in the history struck through.
  revokedAt: string | null;
  revokedBy: { name: string } | null;
  entries: ChangeEntry[];
}

/** What every formula in the budget came to. `EvalResult`'s Maps as plain JSON. */
export interface Evaluated {
  vars: Record<string, number>;
  accounts: Record<string, number>;
  lineItems: Record<string, number>;
  cells: Record<string, number>;
  badLineItems: string[];
  badVariables: string[];
  /** Account keys ("CC:KONTO") whose total is missing a row that didn't resolve. */
  badAccounts: string[];
  errors: string[];
}

export interface BudgetPayload {
  id: string;
  name: string;
  year: number;
  /** The day the möte adopted it, YYYY-MM-DD, or null while it is a draft. */
  adoptedAt: string | null;
  createdBy: { name: string };
  // Set together when the treasurer locks the budget; every edit is then
  // refused (comments excepted). See lib/budget/access.ts.
  lockedAt: string | null;
  lockedBy: { name: string } | null;
  variables: Variable[];
  costCenters: BudgetCC[];
  /**
   * Optional because the caller may say it does not want them: the budget
   * screen re-derives every figure in the browser after a cell edit, so its
   * re-fetch asks for the rows and works the values out itself. See
   * `getEvaluatedBudget`, and recompute.ts on the client.
   */
  evaluated?: Evaluated;
  // The editorial history, oldest first. Already folded into `evaluated`, the
  // figures here are the ones in force, and shown as its own rows in the sheet
  // and in full under the changes view.
  changes: BudgetChange[];
  // The year's actual outcome from the Fortnox ledger, already shaped as a side
  // of a comparison (lib/budget/compare.ts). It holds what the ledger reports
  // on cost centres and accounts this budget never mentions, too.
  actuals?: CompareSheet[];
  actualsSynced?: boolean;
  actualsYear?: number;
}

/**
 * A payload whose figures were asked for, and are therefore there.
 *
 * Only one caller leaves them out (the budget screen's re-fetch after a write,
 * which derives them in the browser), so the ordinary case is this one and it
 * is worth a name: everything that reads `budget.evaluated` can then say so in
 * its type rather than testing, or worse asserting, at the point of use.
 */
export type EvaluatedBudgetPayload = BudgetPayload & { evaluated: Evaluated };

/**
 * The evaluator's answer as the payload carries it: its Maps flattened to plain
 * objects, and nothing else changed.
 *
 * Here rather than at either call site because both the loader and the browser's
 * own recompute produce this, and the two must produce the same thing. They had
 * a copy each, eight keys long, and a key added to one of them would have gone
 * unnoticed on the other until something on screen was quietly missing.
 */
export const toEvaluated = (r: EvalResult): Evaluated => ({
  vars: Object.fromEntries(r.vars),
  accounts: Object.fromEntries(r.accounts),
  lineItems: Object.fromEntries(r.lineItems),
  cells: Object.fromEntries(r.cells),
  badLineItems: r.badLineItems,
  badVariables: r.badVariables,
  badAccounts: r.badAccounts,
  errors: r.errors,
});
