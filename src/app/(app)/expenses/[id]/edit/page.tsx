import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions } from "@/lib/data/bank";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getExpense } from "@/lib/data/expenses";
import { getPayoutAccount, userHoldsCard } from "@/lib/data/users";
import { isAdmin } from "@/lib/domain/permissions";
import { isEditable } from "@/lib/domain/status";
import NewExpenseClient from "../../new/new-client";

// Editing reuses the "New expense" wizard, pre-filled from the existing expense.
export default async function EditExpensePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  const [expense, costCenters, bankTransactions, holdsCard, payout] = await Promise.all([
    getExpense(id, user),
    getCostCenters(),
    getBankTransactions({ cardHolderId: user.id }),
    userHoldsCard(user.id),
    getPayoutAccount(user.id),
  ]);

  if (!expense) redirect("/expenses");
  if (!isEditable(expense.status)) redirect(`/expenses/${expense.id}`);
  // Seeing an utlägg and being able to change it are different rights — an
  // attestant sees their result unit's, and this page is the whole wizard, so
  // it has to ask the same question `canEditExpense` asks on the server rather
  // than let someone fill in a form the save will refuse.
  if (expense.submitterId !== user.id && !isAdmin(user.roles)) {
    redirect(`/expenses/${expense.id}`);
  }

  return (
    <NewExpenseClient
      costCenters={costCenters}
      bankTransactions={bankTransactions}
      holdsCard={holdsCard}
      payoutClearing={payout.clearing}
      payoutAccount={payout.account}
      existing={expense}
    />
  );
}
