import { requirePage } from "@/lib/server/current-user";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { getExpensePage } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import BookkeepingClient from "./bookkeeping-client";

export default async function BookkeepingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canAccessBookkeeping);
  const query = parseListQuery(await searchParams);

  const [page, fortnox] = await Promise.all([
    // Bookkeeping picks up where approval ends, so that is what the page asks
    // for, rather than everything, cut down to it once it has arrived.
    getExpensePage(user, { kind: "signed" }, query),
    // With the viewer, so the export button knows whether they have a Fortnox
    // login of their own. The export writes under it, not the service account.
    getFortnoxStatus(user.id),
  ]);
  return <BookkeepingClient page={page} fortnox={fortnox} />;
}
