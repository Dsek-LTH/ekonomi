// Budgets side by side, one column each. Rows are a full outer join (lib/budget/compare.ts):
// something only some budgets have stays a row, blank elsewhere, since the blank is usually
// the finding. The chosen budgets live in the URL (`?b=id,id,id`), so adding or removing a
// column is a navigation and the loader runs again.

import { requireUser } from "@/lib/server/current-user";
import { getBudgetSummaries, getEvaluatedBudget } from "@/lib/data/budget";
import { budgetLabel, snapshotOf, type Snapshot } from "@/lib/budget/compare";
import { CompareClient } from "./compare-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("budgetCompare");

export default async function BudgetComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  await requireUser();
  const params = await searchParams;

  // `?b=` is the list; `?a=`/`?b=` single ids are what older links carry.
  const ids = [
    ...new Set(
      [params.a ?? "", ...(params.b ?? "").split(",")].map((s) => s.trim()).filter(Boolean),
    ),
  ];

  const [loaded, all] = await Promise.all([
    // No outcome: `snapshotOf` takes sheets and evaluated figures, never the ledger.
    Promise.all(ids.map((id) => getEvaluatedBudget(id, { actuals: false }))),
    getBudgetSummaries(),
  ]);

  // In URL order. A budget deleted since the link was made drops out.
  const snapshots: Snapshot[] = loaded
    .filter((b): b is NonNullable<typeof b> => b !== null)
    .map((budget) => snapshotOf(budget, budgetLabel(budget)));

  return (
    <CompareClient
      ids={ids}
      snapshots={snapshots}
      options={all
        .filter((b) => !ids.includes(b.id))
        .map((b) => ({ value: b.id, label: budgetLabel(b) }))}
    />
  );
}
