// Evaluating a budget in the browser.
//
// The same `evaluate` the server runs (lib/budget/eval.ts), over the same
// inputs, so the figures cannot differ by where they were worked out. The
// client needs it for two things, and they are the same thing twice:
//
//  - a committed cell, which is applied locally and re-evaluated here rather
//    than fetched back, so typing a figure does not wait on a round trip;
//  - the re-read after any other write, which now asks the server for the
//    budget's rows and not for their values. Sending them meant evaluating the
//    whole budget again on the server and putting every line's figure, every
//    account total and every cell into the response — and then the very next
//    cell edit recomputed the lot here anyway.
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { sheetKey } from "@/lib/budget";
import { evaluate } from "@/lib/budget/eval";
import { adjustmentsByAccount } from "@/lib/budget/changes";
import type { Budget, Evaluated } from "./budget-types";

/** The budget with its `evaluated` derived from its own rows. */
export function recomputeBudget(rev: Budget): Budget {
  const varInputs = rev.variables.map((v) => ({ name: v.name, expression: v.expression }));
  const liInputs = rev.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((a) =>
      a.lineItems.map((li) => ({
        id: li.id,
        accountKey: `${sheetKey(cc)}:${a.accountCode}`,
        expression: li.expression,
        values: li.values,
      })),
    ),
  );
  // Editorial changes are part of every account total the server sends, so they
  // have to be part of the one computed here too — otherwise editing any cell
  // would silently drop them until the next reload. (Cells are only editable
  // while the budget is unlocked, and changes are only made while it is locked;
  // but an unlocked budget still carries the ones made earlier.)
  const netByAccount = adjustmentsByAccount(rev.changes);
  const adjustments = rev.costCenters.flatMap((cc) =>
    cc.accounts.flatMap((a) => {
      const amount = netByAccount.get(a.id);
      return amount === undefined || amount === 0
        ? []
        : [{ accountKey: `${sheetKey(cc)}:${a.accountCode}`, amount }];
    }),
  );
  // Every account the budget holds, rows or no rows: an `account(CC, KONTO)`
  // naming one of these is empty rather than broken. As the loader does it.
  const knownAccounts = rev.costCenters.flatMap((cc) =>
    cc.accounts.map((a) => `${sheetKey(cc)}:${a.accountCode}`),
  );
  const r = evaluate(varInputs, liInputs, [...EXTRA_COLUMN_KEYS], adjustments, knownAccounts);
  const evaluated: Evaluated = {
    vars: Object.fromEntries(r.vars),
    accounts: Object.fromEntries(r.accounts),
    lineItems: Object.fromEntries(r.lineItems),
    cells: Object.fromEntries(r.cells),
    badLineItems: r.badLineItems,
    badVariables: r.badVariables,
    badAccounts: r.badAccounts,
    errors: r.errors,
  };
  return { ...rev, evaluated };
}
