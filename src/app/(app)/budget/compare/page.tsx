// Budgets side by side: any number of them, one column each.
//
// Every row is a full outer join (lib/budget/compare.ts): a cost centre, an
// account or a row that only some of the budgets have is still a row here, blank
// in the columns that don't have it. That blank is usually the finding, so it is
// never a reason to drop the row.
//
// Which budgets are shown lives in the URL (`?b=id,id,id`), so a comparison can
// be linked to and returned to. Nothing about it is stored: budgets don't know
// about each other, and a comparison is a question someone asks, not a property
// of any budget involved.
//
// The URL is also why this is a Server Component and still works: `searchParams`
// is an input to the page, so adding or removing a column is a navigation, and
// the loading below simply runs again. It used to fetch each budget from the
// browser, which meant a budget that failed to load was indistinguishable from
// one that had been deleted, both quietly vanished from the comparison.

import { requireUser } from "@/lib/server/current-user";
import { getBudgetSummaries, getEvaluatedBudget } from "@/lib/data/budget";
import { budgetLabel, snapshotOf, type Snapshot } from "@/lib/budget/compare";
import { CompareClient } from "./compare-client";

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
      [params.a ?? "", ...(params.b ?? "").split(",")]
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];

  const [loaded, all] = await Promise.all([
    // No outcome: this page reads each budget through `snapshotOf`, which takes
    // its sheets and its evaluated figures and never the ledger, and a snapshot
    // is what crosses to the client, not the budget.
    Promise.all(ids.map((id) => getEvaluatedBudget(id, { actuals: false }))),
    getBudgetSummaries(),
  ]);

  // In the order the URL names them. A budget deleted since the link was made
  // simply drops out. The comparison is still readable without it, and there is
  // nothing to say about a budget that no longer exists.
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
