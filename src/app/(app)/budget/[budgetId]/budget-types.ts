// Shared types for the budget view (mirror the API response).
import type { ReactNode } from "react";
import type { AccountKind } from "@/lib/budget";
import type { ChangeKind } from "@/lib/budget/changes";
import type { CompareSheet } from "@/lib/budget/compare";

export interface LineItem {
  id: string; description: string;
  expression: string; // the Belopp cell — a literal number or "=…" formula
  sortOrder: number;
  values: Record<string, string>; // per-line values for the six general columns, keyed x1…x6
}

// A buffered new-row / variable draft.
export interface Draft { description: string; expression: string }
export interface Comment { id: string; body: string; createdAt: string; author: { id: string; name: string } }
export interface Account {
  id: string; accountCode: string; accountName: string; sortOrder: number;
  kindOverride: AccountKind | null;
  lineItems: LineItem[]; comments: Comment[];
}
// One sheet in the budget. `costCenter` is null while the sheet isn't linked to
// one — a fresh clone, or a budget drafted before the cost centre existed — and
// `label` is what it's called until it is. See BudgetCostCenter in
// schema.prisma; `sheetKey`/`sheetName` in lib/budget resolve the two cases.
export interface BudgetCC {
  id: string; sortOrder: number; label: string | null;
  costCenter: { id: string; code: string; name: string; resultUnit: string | null } | null;
  accounts: Account[];
}
export interface Variable { id: string; name: string; expression: string; sortOrder: number }

// One account's share of a change, and the change itself. See BudgetChange in
// schema.prisma for what the two kinds mean; the arithmetic is in
// lib/budget/changes.ts, which both this view and the API read.
export interface ChangeEntry { id: string; accountId: string; amount: number }
export interface BudgetChange {
  id: string;
  seq: number; // running number within the budget — "avsteg #4"
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
export interface Evaluated {
  vars: Record<string, number>; accounts: Record<string, number>; lineItems: Record<string, number>;
  cells: Record<string, number>; badLineItems: string[]; badVariables: string[];
  /** Account keys ("CC:KONTO") whose total is missing a row that didn't resolve. */
  badAccounts: string[];
  errors: string[];
}
export interface Budget {
  id: string; name: string; year: number;
  createdBy: { name: string };
  // Set together when the treasurer locks the budget; every edit is then
  // refused (comments excepted). See lib/budget/access.ts.
  lockedAt: string | null; lockedBy: { name: string } | null;
  variables: Variable[]; costCenters: BudgetCC[]; evaluated: Evaluated;
  // The editorial history, oldest first. Already folded into `evaluated` — the
  // figures here are the ones in force — and shown as its own rows in the sheet
  // and in full under the changes view.
  changes: BudgetChange[];
  // The year's actual outcome from the Fortnox ledger, already shaped as a side
  // of a comparison (lib/budget/compare.ts) — it holds what the ledger reports
  // on cost centres and accounts this budget never mentions, too.
  actuals?: CompareSheet[]; actualsSynced?: boolean; actualsYear?: number;
}

/**
 * What has been copied, and what it was. Ids rather than contents: the server
 * has the rows, and a copy that carried its own idea of what a row is would be
 * a second description for the paste to get wrong (see the paste route).
 *
 * It lives on the page rather than in a sheet, because the whole point is to
 * cross from one cost centre to another and a sheet is unmounted the moment you
 * leave it. `label` is what to call it in the paste hint — "3 rader", "3011".
 */
export type BudgetClip =
  | { kind: "rows"; ids: string[]; label: string }
  | { kind: "accounts"; ids: string[]; label: string };

/**
 * A write, and what it does to the budget on screen. Returns ok.
 *
 * `apply` is the difference between a fast write and a slow one. A create route
 * hands back the row it made, a delete says it deleted, a reorder was this
 * screen's own arrangement — so where the caller can say what changed, it says
 * so and the budget is patched in place. Where it can't, it leaves `apply` off
 * and the whole budget is read back, which is correct and costs a round trip.
 *
 * The patch runs before the figures are re-derived, so an applier only has to
 * move rows about; what they come to is worked out afterwards (see recompute).
 */
export type ApiFn = (
  url: string,
  method: string,
  body?: unknown,
  apply?: (budget: Budget, data: unknown) => Budget,
) => Promise<boolean>;

// The page's `useMutation().mutate`, as the sheets need it: the shared write
// path, so a rejected cell edit reports the server's reason the same way every
// other write in the app does.
export type MutateFn = ReturnType<typeof import("@/components/shell/use-mutation").useMutation>["mutate"];

export interface CellArgs {
  id: string; field: string; actual: string; className?: string; placeholder?: string; mono?: boolean;
  url: string; payload: (v: string) => Record<string, unknown>;
  gated?: boolean; // budget-sheet cell: navigable + read-only until edit mode
}
export type CellFn = (a: CellArgs) => ReactNode;

export interface FormulaArgs {
  id: string; field: string; raw: string; computed: number | undefined; sheet: string;
  bad?: boolean; placeholder?: string; url: string; payload: (v: string) => Record<string, unknown>; className?: string;
  // "value" (default): show the evaluated value when idle, formula on focus.
  // "formula": always show the formula (used where a separate value column exists).
  display?: "value" | "formula";
  gated?: boolean;
  /**
   * What `computed` is. The same cell renderer draws a line item's Belopp and a
   * variable's value, and those are not the same kind of number: a Belopp is
   * money in öre, a variable may be a headcount or a share and is nobody's
   * currency. Money is the default because almost every cell is one.
   */
  unit?: "ore" | "scalar";
}
export type FormulaFn = (a: FormulaArgs) => ReactNode;
