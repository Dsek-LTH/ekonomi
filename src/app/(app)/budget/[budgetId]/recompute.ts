// Evaluating a budget in the browser with the server's own `evaluate` (lib/budget/eval.ts)
// and input builder (lib/budget/inputs.ts), so figures cannot differ by where they were
// worked out. Used for committed cells and after reads that skip the evaluated figures.
import { EXTRA_COLUMN_KEYS } from "@/lib/budget/grid";
import { evaluate } from "@/lib/budget/eval";
import { evaluatorInputs } from "@/lib/budget/inputs";
import { toEvaluated } from "@/lib/budget/payload";
import type { Budget } from "./budget-types";

/** The budget with its `evaluated` derived from its own rows. */
export function recomputeBudget(rev: Budget): Budget {
  // Editorial changes are part of every account total the server sends, so they must be here
  // too, or any cell edit would drop them until reload (`evaluatorInputs` folds them in).
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
