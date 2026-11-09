// Types for the budget view. The wire shape lives in lib/budget/payload.ts (re-exported here).
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

/** A budget as this screen holds one. `evaluated` is optional on the wire but always set here, since `recomputeBudget` (recompute.ts) derives it. */
export type Budget = BudgetPayload & { evaluated: Evaluated };

export interface Draft {
  description: string;
  expression: string;
}

/** What has been copied, by id (the server has the rows). Held on the page because a sheet unmounts when you leave it. `label` is shown in the paste hint ("3 rader"). */
export type BudgetClip =
  | { kind: "rows"; ids: string[]; label: string }
  | { kind: "accounts"; ids: string[]; label: string };

/**
 * A write and what it does to the budget on screen. `apply` patches the budget in place
 * where the caller can say what changed (before figures are re-derived); without it the
 * whole budget is read back.
 */
export type ApiFn = (
  url: string,
  method: string,
  body?: unknown,
  apply?: (budget: Budget, data: unknown) => Budget,
) => Promise<boolean>;

// The page's `useMutation().mutate` as the sheets need it.
export type MutateFn = ReturnType<
  typeof import("@/components/shell/use-mutation").useMutation
>["mutate"];

export interface CellArgs {
  id: string;
  field: string;
  actual: string;
  className?: string;
  placeholder?: string;
  mono?: boolean;
  url: string;
  payload: (v: string) => Record<string, unknown>;
  gated?: boolean;
}
export type CellFn = (a: CellArgs) => ReactNode;

export interface FormulaArgs {
  id: string;
  field: string;
  raw: string;
  computed: number | undefined;
  sheet: string;
  bad?: boolean;
  placeholder?: string;
  url: string;
  payload: (v: string) => Record<string, unknown>;
  className?: string;

  display?: "value" | "formula";
  gated?: boolean;
  /** What `computed` is: money in öre (the default) or a plain number such as a headcount. */
  unit?: "ore" | "scalar";
}
export type FormulaFn = (a: FormulaArgs) => ReactNode;
