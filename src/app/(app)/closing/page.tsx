import { requirePage } from "@/lib/server/current-user";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { getClosingYears } from "@/lib/data/closing";
import ClosingYearsClient from "./years-client";

// Bokslut: one per financial year Fortnox has, as far as the ledger has been
// synced. Readable by whoever may read the books, which is the treasury and
// the revisorer.
export default async function ClosingPage() {
  await requirePage(canViewBookkeeping);
  const years = await getClosingYears();
  return <ClosingYearsClient years={years} />;
}
