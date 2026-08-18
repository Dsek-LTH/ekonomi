// What the budget is being held up against — the second figure beside every
// amount, the difference from it, and the rows only the other side has.
//
// Nothing is compared until asked for: a budget is read on its own most of the
// time, and two extra columns of someone else's numbers are noise until they are
// the question. The target may be the year's actual outcome from Fortnox, or any
// other budget of any year — holding 2026 against 2025's adopted budget is as
// ordinary a question as holding it against its own utfall.
//
// The join itself lives in lib/budget/compare.ts, and is built even when nothing
// is being compared — one side, joined with nothing. That way every view reads
// its rows from one place, instead of switching between "my rows" and "the
// joined rows" depending on whether a comparison happens to be on.
"use client";

import { useEffect, useMemo, useState } from "react";
import { budgetLabel, joinSnapshots, snapshotOf, type Joined, type Snapshot } from "@/lib/budget/compare";
import type { Budget } from "./budget-types";

// The sentinel target for "this year's outcome from Fortnox". Anything else is
// a budget id; "" is no comparison at all.
export const ACTUALS = "__actuals__";

interface BudgetSummary { id: string; year: number; name: string }

// Flat, and every label leads with its year — the picker searches on the label,
// so typing "2025" narrows to that year without needing grouped sections.
export interface CompareOption { value: string; label: string }

export interface Comparison {
  /** This budget, and — when one is picked — what it is being held against. */
  joined: Joined;
  /** The compared side's column heading; null when nothing is compared. */
  otherLabel: string | null;
}

export function useComparison(budget: Budget) {
  const [target, setTarget] = useState("");
  const [budgets, setBudgets] = useState<BudgetSummary[]>([]);
  // The other budget's figures, once one is picked. Held apart from `target` so
  // the columns don't flicker in half-loaded while a big budget arrives.
  const [other, setOther] = useState<{ id: string; snapshot: Snapshot } | null>(null);

  // The picker's contents. Fetched once — a shallow list of every budget is
  // small, and it is needed the moment the picker is opened.
  useEffect(() => {
    let live = true;
    fetch("/api/budgets")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => { if (live) setBudgets(data); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  // Fetch the picked budget and keep it as a comparison side. `live` guards the
  // slow-response-arrives-after-you-switched-again case. What was loaded before
  // is left in place rather than cleared: `comparison` below only reads it while
  // it matches the current target, so a stale one is already invisible, and
  // clearing it here would be a render for nothing.
  useEffect(() => {
    if (!target || target === ACTUALS) return;
    let live = true;
    // Without the outcome: a comparison reads the other budget's sheets and its
    // evaluated figures, never the ledger beside it (see `snapshotOf`), and
    // gathering that is a group-by over the other year's whole ledger.
    fetch(`/api/budgets/${target}?actuals=0`)
      .then((r) => r.ok ? r.json() : null)
      .then((b: Budget | null) => {
        if (!live || !b) return;
        setOther({ id: b.id, snapshot: snapshotOf(b, budgetLabel(b)) });
      })
      .catch(() => {});
    return () => { live = false; };
  }, [target]);

  const options = useMemo<CompareOption[]>(() => {
    const out: CompareOption[] = [{
      value: ACTUALS,
      label: budget.actualsSynced
        ? `Utfall ${budget.actualsYear}`
        : `Utfall ${budget.actualsYear ?? budget.year} (ej synkat)`,
    }];
    for (const b of budgets) {
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
    // Still loading, or the budget went away — this budget on its own rather
    // than half a comparison.
    if (target && other && other.id === target) {
      return { joined: joinSnapshots([own, other.snapshot]), otherLabel: other.snapshot.label };
    }
    return { joined: joinSnapshots([own]), otherLabel: null };
  }, [budget, target, other]);

  return { target, setTarget, options, comparison };
}
