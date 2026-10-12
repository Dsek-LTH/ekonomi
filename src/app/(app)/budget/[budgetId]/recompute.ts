// Evaluating a budget in the browser.
//
// The same `evaluate` the server runs (lib/budget/eval.ts), over inputs built
// by the same function (lib/budget/inputs.ts), so the figures cannot differ by
// where they were worked out. That last part used to be a third hand-written
// copy of the walk, alongside the loader's and the ledger comparison's.
//
// The client needs it for two things, and they are the same thing twice:
//
//  - a committed cell, which is applied locally and re-evaluated here rather
//    than fetched back, so typing a figure does not wait on a round trip;
//  - the re-read after any other write, which now asks the server for the
//    budget's rows and not for their values. Sending them meant evaluating the
//    whole budget again on the server and putting every line's figure, every
//    account total and every cell into the response, and then the very next
//    cell edit recomputed the lot here anyway.
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { evaluate } from "@/lib/budget/eval";
import { evaluatorInputs } from "@/lib/budget/inputs";
import { toEvaluated } from "@/lib/budget/payload";
import type { Budget } from "./budget-types";

/** The budget with its `evaluated` derived from its own rows. */
export function recomputeBudget(rev: Budget): Budget {
  // Editorial changes are part of every account total the server sends, so they
  // have to be part of the one computed here too, otherwise editing any cell
  // would silently drop them until the next reload. `evaluatorInputs` folds
  // them in, which is one of the reasons it is shared. (Cells are only editable
  // while the budget is unlocked, and changes are only made while it is locked;
  // but an unlocked budget still carries the ones made earlier.)
  const inputs = evaluatorInputs(rev);
  const figures = evaluate(
    inputs.variables,
    inputs.lineItems,
    [...EXTRA_COLUMN_KEYS],
    inputs.adjustments,
    inputs.knownAccounts,
  );
  return { ...rev, evaluated: toEvaluated(figures) };
}
