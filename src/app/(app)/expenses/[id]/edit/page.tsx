import { redirect } from "next/navigation";
import { requireUser } from "@/lib/server/current-user";
import { getBankTransactions } from "@/lib/data/bank";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getExpense, getExpenseFingerprints } from "@/lib/data/expenses";
import { getPayoutAccount, userHoldsCard } from "@/lib/data/users";
import { isAdmin } from "@/lib/domain/permissions";
import { isEditable } from "@/lib/domain/status";
import { getMileageRates } from "@/lib/mileage/store";
import NewExpenseClient from "../../new/new-client";
import MileageClient from "../../new/mileage/mileage-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("editExpense");

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
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
  // Seeing an utlägg is not the right to change it (canEditExpense), and this page is the whole wizard.
  if (expense.submitterId !== user.id && !isAdmin(user.capabilities)) {
    redirect(`/expenses/${expense.id}`);
  }

  if (expense.paymentType === "MILEAGE") {
    return (
      <MileageClient
        costCenters={costCenters}
        payoutClearing={payout.clearing}
        payoutAccount={payout.account}
        rates={await getMileageRates()}
        existing={expense}
      />
    );
  }

  return (
    <NewExpenseClient
      costCenters={costCenters}
      bankTransactions={bankTransactions}
      holdsCard={holdsCard}
      payoutClearing={payout.clearing}
      payoutAccount={payout.account}
      // The submitter's, not the viewer's: an admin editing somebody's utlägg
      // is asking whether *they* handed it in twice.
      ownExpenses={await getExpenseFingerprints(expense.submitterId)}
      existing={expense}
    />
  );
}
