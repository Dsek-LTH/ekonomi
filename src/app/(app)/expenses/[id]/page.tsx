import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions, getBankTransactionsByIds } from "@/lib/data/bank";
import { getExpense } from "@/lib/data/expenses";
import { getExpenseQueues } from "@/lib/data/expense-queue";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { expenseCapabilities } from "@/lib/domain/expense-capabilities";
import ExpenseDetailClient from "./detail-client";

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // Two waves, because the second depends on the first. The bank rows this page
  // may show are the *submitter's* card purchases, whoever made the purchase,
  // not whoever is looking at it. That is the rule the match route enforces
  // (bank.txnNotExpenseCard), and loading the viewer's instead offered a
  // bookkeeper their own transactions on somebody else's utlägg: a list where
  // every row was refused on arrival.
  //
  // A page ships what it asks for, so asking for the whole feed would publish
  // the whole feed to anyone who can open an utlägg. The one exception is the
  // transaction this utlägg is already matched to: a bookkeeper looking at
  // someone else's card purchase still has to see what it was matched against,
  // so it is named explicitly rather than reached by widening the rule.
  const [expense, fortnox, queues] = await Promise.all([
    getExpense(id, user),
    // With the user id, so the status carries their own Fortnox login and not
    // just the section's connection. Exporting needs both, and without this the
    // page couldn't tell that half of it was missing.
    getFortnoxStatus(user.id),
    // What is next in the attest and bookkeeping queues, for the bar that
    // offers it when this utlägg was opened from one of them.
    getExpenseQueues(user, id),
  ]);

  // What this viewer may do with this utlägg, worked out here rather than
  // again in the browser. `canAttest` is already stamped per allocation by the
  // loader; this is the rest of the same question, asked in the same place.
  //
  // Before the bank rows, because it decides which of them this page is allowed
  // to carry.
  const can = expense
    ? expenseCapabilities(expense, {
        id: user.id,
        roles: user.roles,
        capabilities: user.capabilities,
      })
    : null;

  const matched = expense?.matchedTransactionId ? [expense.matchedTransactionId] : [];
  const bankTransactions = !expense
    ? []
    : can?.canMatch
      ? // Candidates for the picker: the submitter's own unmatched purchases,
        // plus whatever this utlägg already points at.
        await getBankTransactions({ cardHolderId: expense.submitterId, alsoIds: matched })
      : // Everyone else who may see this page (a resultatansvarig, a
        // bookkeeper on a signed utlägg) gets the one row it is matched to and
        // no browsing. They have no picker to fill, and a page ships what it
        // asks for.
        await getBankTransactionsByIds(matched);

  return (
    <ExpenseDetailClient
      expense={expense}
      can={can}
      bankTransactions={bankTransactions}
      fortnox={fortnox}
      queues={queues}
    />
  );
}
