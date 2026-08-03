import { requireUser } from "@/lib/server/current-user";
import { getExpenseSummaries } from "@/lib/data/expenses";
import { ExpensesClient } from "./expenses-client";

export default async function ExpensesPage() {
  const user = await requireUser();
  const expenses = await getExpenseSummaries(user);
  return <ExpensesClient expenses={expenses} />;
}
