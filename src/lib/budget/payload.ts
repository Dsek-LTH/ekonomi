// One description of a budget as it crosses the wire, imported by both the loader and the client.
// Plain JSON: dates are ISO strings, matching what a fetch delivers (see `getEvaluatedBudget`).
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

/** One sheet. `costCenter` is null while unlinked (a fresh clone) and `label` names it until then. */
export interface BudgetCC {
  id: string;
  sortOrder: number;
  label: string | null;
  costCenter: {
    id: string;
    code: string;
    name: string;
    /** Its name under its result unit's heading. See lib/domain/cost-center-short-name. */
    shortName: string | null;
    resultUnit: string | null;
  } | null;
  accounts: Account[];
}

export interface Variable {
  id: string;
  name: string;
  expression: string;
  sortOrder: number;
}

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
  // Set together when revoked.
  revokedAt: string | null;
  revokedBy: { name: string } | null;
  entries: ChangeEntry[];
}

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
  // Set together when locked; every edit is then refused (comments excepted), see lib/budget/access.ts.
  lockedAt: string | null;
  lockedBy: { name: string } | null;
  variables: Variable[];
  costCenters: BudgetCC[];
  /** Optional: the budget screen re-fetches without them and recomputes in the browser (recompute.ts). */
  evaluated?: Evaluated;
  // The editorial history, oldest first, already folded into `evaluated`.
  changes: BudgetChange[];
  // The year's outcome from the ledger as a comparison side (lib/budget/compare.ts), including accounts the budget never mentions.
  actuals?: CompareSheet[];
  actualsSynced?: boolean;
  actualsYear?: number;
}

/** A payload whose `evaluated` figures were requested and are therefore present. */
export type EvaluatedBudgetPayload = BudgetPayload & { evaluated: Evaluated };

/** The evaluator's answer with its Maps flattened to plain objects. Shared by the loader and the browser recompute, which must agree. */
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
