import { getBankTransactions } from "@/lib/data/bank";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getExpenseFingerprints } from "@/lib/data/expenses";
import { getPayoutAccount, userHoldsCard } from "@/lib/data/users";
import { requireUser } from "@/lib/server/current-user";
import NewExpenseClient from "./new-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("newExpense");

export default async function NewExpensePage() {
  const user = await requireUser();

  // A card purchase is only an option for members who hold a guild card,
  // and a member may only see / match against purchases on their own card.
  const [costCenters, bankTransactions, holdsCard, payout, ownExpenses] = await Promise.all([
    getCostCenters(),
    getBankTransactions({ cardHolderId: user.id }),
    userHoldsCard(user.id),
    getPayoutAccount(user.id),
    getExpenseFingerprints(user.id),
  ]);
  return (
    <NewExpenseClient
      costCenters={costCenters}
      bankTransactions={bankTransactions}
      holdsCard={holdsCard}
      payoutClearing={payout.clearing}
      payoutAccount={payout.account}
      ownExpenses={ownExpenses}
    />
  );
}
