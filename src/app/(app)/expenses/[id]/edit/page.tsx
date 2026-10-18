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

// Editing reuses the form the utlägg was made on, pre-filled from it: the
// wizard for a purchase, the mileage form for a milersättning. Which one is not
// a preference: the two describe different things, and the wizard has no way
// to ask for odometer readings or to leave the amount alone.
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
  // Seeing an utlägg and being able to change it are different rights: an
  // attestant sees their result unit's, and this page is the whole wizard, so
  // it has to ask the same question `canEditExpense` asks on the server rather
  // than let someone fill in a form the save will refuse.
  if (expense.submitterId !== user.id && !isAdmin(user.capabilities)) {
    redirect(`/expenses/${expense.id}`);
  }

  if (expense.paymentType === "MILEAGE") {
    return (
      <MileageClient
        costCenters={costCenters}
        payoutClearing={payout.clearing}
        payoutAccount={payout.account}
        // Every rate, as on the new-claim page: each journey keeps being valued
        // at the one in force on its own day, editing included.
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
