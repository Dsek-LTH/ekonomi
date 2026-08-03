import { requirePage } from "@/lib/server/current-user";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { getExpenseSummaries } from "@/lib/data/expenses";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import BookkeepingClient from "./bookkeeping-client";

export default async function BookkeepingPage() {
  const user = await requirePage(canAccessBookkeeping);
  const [expenses, fortnox] = await Promise.all([
    getExpenseSummaries(user),
    // With the viewer, so the export button knows whether they have a Fortnox
    // login of their own — the export writes under it, not the service account.
    getFortnoxStatus(user.id),
  ]);
  return <BookkeepingClient expenses={expenses} fortnox={fortnox} />;
}
