import { requireUser } from "@/lib/server/current-user";
import { getBudgetSummaries } from "@/lib/data/budget";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { BudgetListClient } from "./budget-list-client";

export default async function BudgetListPage() {
  // Every signed-in member may read the budget (canAccessBudget). Editing is
  // gated per write, in lib/budget/access.ts.
  await requireUser();

  const [budgets, fiscal] = await Promise.all([getBudgetSummaries(), getFiscalYear()]);
  // The year in the header, which is the list's year now: it used to be every
  // budget there has ever been, newest first.
  return <BudgetListClient budgets={budgets} year={fiscal ? Number(fiscal.fromDate.slice(0, 4)) : null} />;
}
