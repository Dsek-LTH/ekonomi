// The one place a budget's rows become evaluator input, so the server, lib/ledger/comparison.ts and the browser
// (budget/[budgetId]/recompute.ts) get the same figures. Isomorphic: no `server-only`, no Prisma import.
import { sheetKey } from ".";
import { adjustmentsByAccount, type ChangeKind } from "./changes";
import type { AdjustmentInput, LineItemInput, VariableInput } from "./eval";

/** The narrowest budget shape evaluation needs. `values` is `unknown`: Prisma's `JsonValue` on the server, a plain record in the browser. */
interface EvaluableBudget {
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

interface EvaluatorInputs {
  variables: VariableInput[];
  lineItems: LineItemInput[];
  /** Editorial changes, netted per account and folded into its total. */
  adjustments: AdjustmentInput[];
  /** Every account the budget holds, so an `account(CC, KONTO)` naming an empty one is zero rather than broken. */
  knownAccounts: string[];
}

export function evaluatorInputs(budget: EvaluableBudget): EvaluatorInputs {
  const netByAccount = adjustmentsByAccount(budget.changes);

  const lineItems: LineItemInput[] = [];
  const adjustments: AdjustmentInput[] = [];
  const knownAccounts: string[] = [];

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

      // A zero-net change is left out: the evaluator reads the list's length to decide whether an account was adjusted.
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
