import { getBookedIncome } from "@/lib/data/income";
import { canAccessBookkeeping, canUnexport } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";

import BookedClient from "./booked-client";

export default async function BookedIncomePage() {
  const user = await requirePage(canAccessBookkeeping);

  const reports = await getBookedIncome();

  // Undoing any of this — unexporting, unbooking, deleting — is the treasury's
  // to do, not everyone with bookkeeping access. Decided here, where the roles
  // are, and enforced again by every route behind the buttons.
  return <BookedClient reports={reports} canManage={canUnexport(user.roles)} />;
}
