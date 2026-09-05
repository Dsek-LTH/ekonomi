// Turning a budget's rows into what the evaluator reads, in one place.
//
// Three callers evaluate a budget, and they must all get the same number:
//
//   lib/data/budget.ts        the payload the page and the API are built from
//   lib/ledger/comparison.ts  the budget side of a utfall comparison
//   app/(app)/budget/[budgetId]/recompute.ts   the browser, after a cell edit
//
// They had a copy each: the same four flatMaps, the same `${sheetKey(cc)}:${
// acct.accountCode}` twice, the same skip of a zero adjustment. Two of them
// were byte-identical and the third had drifted in its comments only, which is
// the good outcome and not one anything guaranteed. A budget evaluated three
// ways that disagree is a treasurer looking at two screens showing two figures
// for the same account, with nothing failing anywhere.
//
// Structurally typed rather than tied to Prisma's row or to the client's
// `Budget`, so the server may pass what it loaded and the browser may pass what
// it holds, and neither has to convert first. This file is isomorphic: no
// `server-only`, no Prisma import.
import { sheetKey } from ".";
import { adjustmentsByAccount, type ChangeKind } from "./changes";
import type { AdjustmentInput, LineItemInput, VariableInput } from "./eval";

/**
 * As much of a budget as evaluating one needs.
 *
 * Deliberately the narrowest shape that works. `values` is `unknown` because on
 * the server it arrives as Prisma's `JsonValue` and in the browser as a plain
 * record, and neither side gains anything from the other's name for it.
 */
export interface EvaluableBudget {
  variables: readonly { name: string; expression: string }[];
  costCenters: readonly {
    id: string;
    costCenter?: { code: string } | null;
    accounts: readonly {
      id: string;
      accountCode: string;
      lineItems: readonly { id: string; expression: string; values?: unknown }[];
    }[];
  }[];
  changes: readonly {
    kind: ChangeKind;
    revokedAt: Date | string | null;
    entries: readonly { accountId: string; amount: number }[];
  }[];
}

/** What `evaluate` takes, in the order it takes it. */
export interface EvaluatorInputs {
  variables: VariableInput[];
  lineItems: LineItemInput[];
  /**
   * Editorial changes, netted per account and folded into its total, so every
   * figure downstream (account totals, `account(CC, ACCT)` references, the
   * rambudget, the comparison) is the one actually in force. The sheet shows
   * them as rows of their own, which is where the history stays visible.
   */
  adjustments: AdjustmentInput[];
  /**
   * Every account the budget holds, rows or no rows, so an `account(CC, KONTO)`
   * naming an empty one is zero rather than broken.
   */
  knownAccounts: string[];
}

export function evaluatorInputs(budget: EvaluableBudget): EvaluatorInputs {
  const netByAccount = adjustmentsByAccount(budget.changes);

  const lineItems: LineItemInput[] = [];
  const adjustments: AdjustmentInput[] = [];
  const knownAccounts: string[] = [];

  // One walk rather than three: the key is the same string each time, and
  // building it once is what stops two of the three from being built differently.
  for (const cc of budget.costCenters) {
    const sheet = sheetKey(cc);
    for (const account of cc.accounts) {
      const accountKey = `${sheet}:${account.accountCode}`;
      knownAccounts.push(accountKey);

      for (const li of account.lineItems) {
        lineItems.push({
          id: li.id,
          accountKey,
          expression: li.expression,
          values: (li.values ?? {}) as Record<string, string>,
        });
      }

      // A change that nets to nothing is left out rather than passed as zero:
      // the evaluator reads the list's length to decide whether an account was
      // adjusted at all.
      const amount = netByAccount.get(account.id);
      if (amount !== undefined && amount !== 0) adjustments.push({ accountKey, amount });
    }
  }

  return {
    variables: budget.variables.map((v) => ({ name: v.name, expression: v.expression })),
    lineItems,
    adjustments,
    knownAccounts,
  };
}
