// What the budget is held up against: a second figure beside every amount, the difference,
// and the rows only the other side has. Off until asked. The target is the year's Fortnox
// outcome or any other budget of any year. The join (lib/budget/compare.ts) is built even
// with no comparison (one side), so every view reads its rows from one place.
"use client";

import { useMemo, useState } from "react";
import {
  budgetLabel,
  joinSnapshots,
  snapshotOf,
  type Joined,
  type Snapshot,
} from "@/lib/budget/compare";
import { useQuery } from "@/components/shell/use-query";
import type { Budget } from "./budget-types";

// Sentinel target for "this year's outcome from Fortnox". Anything else is a budget id; "" is none.
const ACTUALS = "__actuals__";

interface BudgetSummary {
  id: string;
  year: number;
  name: string;
}

// Every label leads with its year so typing "2025" narrows to that year.
interface CompareOption {
  value: string;
  label: string;
}

export interface Comparison {
  joined: Joined;
  otherLabel: string | null;
}

export function useComparison(budget: Budget) {
  const [target, setTarget] = useState("");

  const { data: budgets } = useQuery<BudgetSummary[]>("/api/budgets");

  // The picked budget, fetched without the outcome (`snapshotOf` never reads the ledger).
  // `keepPrevious` avoids flicker; the stale side is invisible since `comparison` reads it
  // only while its id matches the target.
  const { data: other } = useQuery<Budget>(
    target && target !== ACTUALS ? `/api/budgets/${target}?actuals=0` : null,
  );

  const options = useMemo<CompareOption[]>(() => {
    const out: CompareOption[] = [
      {
        value: ACTUALS,
        label: budget.actualsSynced
          ? `Utfall ${budget.actualsYear}`
          : `Utfall ${budget.actualsYear ?? budget.year} (ej synkat)`,
      },
    ];
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
      const actuals: Snapshot = {
        id: ACTUALS,
        label,
        sheets: budget.actuals ?? [],
        vars: {},
      };
      return { joined: joinSnapshots([own, actuals]), otherLabel: label };
    }
    // Still loading, or the budget went away: show this budget alone, not half a comparison.
    if (target && other && other.id === target) {
      const snapshot = snapshotOf(other, budgetLabel(other));
      return { joined: joinSnapshots([own, snapshot]), otherLabel: snapshot.label };
    }
    return { joined: joinSnapshots([own]), otherLabel: null };
  }, [budget, target, other]);

  return { target, setTarget, options, comparison };
}
