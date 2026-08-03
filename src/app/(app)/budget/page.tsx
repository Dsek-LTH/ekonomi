import { requireUser } from "@/lib/server/current-user";
import { getBudgetSummaries } from "@/lib/data/budget";
import { BudgetListClient } from "./budget-list-client";

export default async function BudgetListPage() {
  // Every signed-in member may read the budget (canAccessBudget). Editing is
  // gated per write, in lib/budget/access.ts.
  await requireUser();

  const budgets = await getBudgetSummaries();
  return <BudgetListClient budgets={budgets} />;
}
