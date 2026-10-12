// Types for the budget view.
//
// What comes off the wire is described once, in lib/budget/payload.ts, which
// the loader returns and this re-exports: there is no second description here
// to drift from it. What is left below is the view's own, the shapes that never
// leave the browser.
import type { ReactNode } from "react";
import type { BudgetPayload, Evaluated } from "@/lib/budget/payload";

export type {
  Account,
  BudgetCC,
  BudgetChange,
  ChangeEntry,
  Comment,
  Evaluated,
  LineItem,
  Variable,
} from "@/lib/budget/payload";

/**
 * A budget as this screen holds one: the payload, with its figures always in
 * hand.
 *
 * `evaluated` is optional on the wire, because the re-fetch after a write asks
 * the server not to compute it. It is never missing *here*: whatever comes back
 * goes through `recomputeBudget` (recompute.ts), which derives the figures in
 * the browser from the rows. So the screen may read them without asking.
 */
export type Budget = BudgetPayload & { evaluated: Evaluated };

// A buffered new-row / variable draft.
export interface Draft { description: string; expression: string }

/**
 * What has been copied, and what it was. Ids rather than contents: the server
 * has the rows, and a copy that carried its own idea of what a row is would be
 * a second description for the paste to get wrong (see the paste route).
 *
 * It lives on the page rather than in a sheet, because the whole point is to
 * cross from one cost centre to another and a sheet is unmounted the moment you
 * leave it. `label` is what to call it in the paste hint, "3 rader", "3011".
 */
export type BudgetClip =
  | { kind: "rows"; ids: string[]; label: string }
  | { kind: "accounts"; ids: string[]; label: string };

/**
 * A write, and what it does to the budget on screen. Returns ok.
 *
 * `apply` is the difference between a fast write and a slow one. A create route
 * hands back the row it made, a delete says it deleted, a reorder was this
 * screen's own arrangement, so where the caller can say what changed, it says
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
