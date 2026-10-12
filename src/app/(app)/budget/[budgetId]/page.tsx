import { notFound } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getAccounts } from "@/lib/data/accounts";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getEvaluatedBudget } from "@/lib/data/budget";
import BudgetClient from "./budget-client";

export default async function BudgetPage({
  params,
}: {
  params: Promise<{ budgetId: string }>;
}) {
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
      // The client keeps editing the budget in its own state (a cell edit
      // re-evaluates the whole sheet in the browser) so this is the first
      // copy, not the live one. It re-fetches the same payload from
      // GET /api/budgets/[id] after each write.
      initialBudget={budget}
      costCenters={costCenters}
      accounts={accounts}
    />
  );
}
