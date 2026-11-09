import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getAccounts } from "@/lib/data/accounts";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getEvaluatedBudget } from "@/lib/data/budget";
import BudgetClient from "./budget-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("budgetSheet");

export default async function BudgetPage({ params }: { params: Promise<{ budgetId: string }> }) {
  const { budgetId } = await params;
  await requireUser();

  const [budget, costCenters, accounts] = await Promise.all([
    getEvaluatedBudget(budgetId),
    getCostCenters(),
    getAccounts(),
  ]);
  if (!budget) notFound();

  return (
    <BudgetClient
      // The client edits the budget in its own state, so this is only the first copy; it
      // re-fetches from GET /api/budgets/[id] after each write.
      initialBudget={budget}
      costCenters={costCenters}
      accounts={accounts}
    />
  );
}
