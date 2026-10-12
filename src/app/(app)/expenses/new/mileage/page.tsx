import { getCostCenters } from "@/lib/data/cost-centers";
import { getPayoutAccount } from "@/lib/data/users";
import { getMileageRates } from "@/lib/mileage/store";
import { requireUser } from "@/lib/server/current-user";
import MileageClient from "./mileage-client";

/**
 * A milersättning's own form.
 *
 * Deliberately not the ordinary wizard with a third branch in it. What is being
 * described is a set of journeys rather than a purchase (no receipt, no amount
 * to type, no card to match against) and the two forms share so little at the
 * top that folding them together would mean a wizard whose first step is mostly
 * conditionals. What they *do* share is everything after: the same utlägg row,
 * the same attest, the same booking and the same export.
 *
 * No bank transactions and no `holdsCard`: a mileage claim is out-of-pocket by
 * construction, so there is nothing to match it against and no card to offer.
 */
export default async function NewMileagePage() {
  const user = await requireUser();

  const [costCenters, payout, rates] = await Promise.all([
    getCostCenters(),
    getPayoutAccount(user.id),
    // Every rate, not just the current one: each journey is valued at the rate
    // in force on its own day, so the form needs the same table the server
    // does. That is what lets the total on screen be the total that is stored.
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
