import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions } from "@/lib/data/bank";
import { getExpense } from "@/lib/data/expenses";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import ExpenseDetailClient from "./detail-client";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // Two waves, because the second depends on the first. The bank rows this page
  // may show are the viewer's own card purchases — the picker offers nothing
  // else, and a page ships what it asks for, so asking for the whole feed would
  // publish the whole feed to anyone who can open an utlägg. The one exception
  // is the transaction this utlägg is already matched to: a bookkeeper looking
  // at someone else's card purchase still has to see what it was matched
  // against, so it is named explicitly rather than reached by widening the rule.
  const [expense, fortnox] = await Promise.all([
    getExpense(id, user),
    // With the user id, so the status carries their own Fortnox login and not
    // just the section's connection. Exporting needs both, and without this the
    // page couldn't tell that half of it was missing.
    getFortnoxStatus(user.id),
  ]);

  const bankTransactions = await getBankTransactions({
    cardHolderId: user.id,
    alsoIds: expense?.matchedTransactionId ? [expense.matchedTransactionId] : [],
  });

  return (
    <ExpenseDetailClient
      expense={expense}
      bankTransactions={bankTransactions}
      fortnox={fortnox}
    />
  );
}
