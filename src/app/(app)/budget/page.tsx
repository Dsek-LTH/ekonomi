import { requireUser } from "@/lib/server/current-user";
import { getBudgetSummaries } from "@/lib/data/budget";
import { getFiscalYear } from "@/lib/server/fiscal-year";
import { BudgetListClient } from "./budget-list-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("budget");

export default async function BudgetListPage() {
  // Every signed-in member may read (canAccessBudget); writes are gated in lib/budget/access.ts.
  await requireUser();

  const [budgets, fiscal] = await Promise.all([getBudgetSummaries(), getFiscalYear()]);

  return (
    <BudgetListClient
      budgets={budgets}
      year={fiscal ? Number(fiscal.fromDate.slice(0, 4)) : null}
    />
  );
}
