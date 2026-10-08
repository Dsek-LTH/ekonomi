// What the budget is being held up against, the second figure beside every
// amount, the difference from it, and the rows only the other side has.
//
// Nothing is compared until asked for: a budget is read on its own most of the
// time, and two extra columns of someone else's numbers are noise until they are
// the question. The target may be the year's actual outcome from Fortnox, or any
// other budget of any year. Holding 2026 against 2025's adopted budget is as
// ordinary a question as holding it against its own utfall.
//
// The join itself lives in lib/budget/compare.ts, and is built even when nothing
// is being compared, one side, joined with nothing. That way every view reads
// its rows from one place, instead of switching between "my rows" and "the
// joined rows" depending on whether a comparison happens to be on.
"use client";

import { useMemo, useState } from "react";
import { budgetLabel, joinSnapshots, snapshotOf, type Joined, type Snapshot } from "@/lib/budget/compare";
import { useQuery } from "@/components/shell/use-query";
import type { Budget } from "./budget-types";

// The sentinel target for "this year's outcome from Fortnox". Anything else is
// a budget id; "" is no comparison at all.
const ACTUALS = "__actuals__";

interface BudgetSummary { id: string; year: number; name: string }

// Flat, and every label leads with its year, the picker searches on the label,
// so typing "2025" narrows to that year without needing grouped sections.
interface CompareOption { value: string; label: string }

export interface Comparison {
  /** This budget, and, when one is picked, what it is being held against. */
  joined: Joined;
  /** The compared side's column heading; null when nothing is compared. */
  otherLabel: string | null;
}

export function useComparison(budget: Budget) {
  const [target, setTarget] = useState("");

  // The picker's contents. A shallow list of every budget is small, and it is
  // needed the moment the picker is opened.
  const { data: budgets } = useQuery<BudgetSummary[]>("/api/budgets");

  // The picked budget, fetched without the outcome: a comparison reads the
  // other budget's sheets and its evaluated figures, never the ledger beside it
  // (see `snapshotOf`), and gathering that is a group-by over the other year's
  // whole ledger.
  //
  // `keepPrevious` so the columns do not flicker in half-loaded while a big
  // budget arrives. The stale side is invisible anyway: `comparison` below only
  // reads it while its id matches the current target.
  const { data: other } = useQuery<Budget>(
    target && target !== ACTUALS ? `/api/budgets/${target}?actuals=0` : null,
  );

  const options = useMemo<CompareOption[]>(() => {
    const out: CompareOption[] = [{
      value: ACTUALS,
      label: budget.actualsSynced
        ? `Utfall ${budget.actualsYear}`
        : `Utfall ${budget.actualsYear ?? budget.year} (ej synkat)`,
    }];
    for (const b of budgets ?? []) {
      if (b.id === budget.id) continue; // never against itself
      out.push({ value: b.id, label: budgetLabel(b) });
    }
    return out;
  }, [budgets, budget]);

  const comparison = useMemo<Comparison>(() => {
    const own = snapshotOf(budget, budgetLabel(budget));

    if (target === ACTUALS) {
      const label = `Utfall ${budget.actualsYear ?? budget.year}`;
      const actuals: Snapshot = { id: ACTUALS, label, sheets: budget.actuals ?? [], vars: {} };
      return { joined: joinSnapshots([own, actuals]), otherLabel: label };
    }
    // Still loading, or the budget went away. This budget on its own rather
    // than half a comparison. The id test is what makes a stale side invisible:
    // it is the previous target's budget until the new one lands.
    if (target && other && other.id === target) {
      const snapshot = snapshotOf(other, budgetLabel(other));
      return { joined: joinSnapshots([own, snapshot]), otherLabel: snapshot.label };
    }
    return { joined: joinSnapshots([own]), otherLabel: null };
  }, [budget, target, other]);

  return { target, setTarget, options, comparison };
}
