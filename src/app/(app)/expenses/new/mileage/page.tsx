import { getCostCenters } from "@/lib/data/cost-centers";
import { getPayoutAccount } from "@/lib/data/users";
import { getMileageRates } from "@/lib/mileage/store";
import { requireUser } from "@/lib/server/current-user";
import MileageClient from "./mileage-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("newMileage");

// Not the ordinary wizard: no receipt, no amount to type, no card to match, so no bank transactions and no `holdsCard`.
export default async function NewMileagePage() {
  const user = await requireUser();

  const [costCenters, payout, rates] = await Promise.all([
    getCostCenters(),
    getPayoutAccount(user.id),
    // Every rate: each journey is valued at the rate in force on its own day, as on the server.
    getMileageRates(),
  ]);

  return (
    <MileageClient
      costCenters={costCenters}
      payoutClearing={payout.clearing}
      payoutAccount={payout.account}
      rates={rates}
    />
  );
}
