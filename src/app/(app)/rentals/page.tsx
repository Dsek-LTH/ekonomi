import { requirePage } from "@/lib/server/current-user";
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
import { getRentalPage, getRentalStateCounts } from "@/lib/data/rentals";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { today } from "@/lib/domain/date";
import { RentalsClient } from "./rentals-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("rentals");

// Uthyrning: where the gear is, rather than which agreements exist (same Contract rows as the archive; see lib/data/rentals.ts).
export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewRentals);

  // "Att göra" is the resting tab: what is late and what is back but not dealt with.
  const query = parseListQuery(await searchParams, { defaultTab: "todo" });

  // One day for the whole page, so a list left open over midnight cannot disagree with itself.
  const asOf = today();

  const [page, counts] = await Promise.all([
    getRentalPage(query, asOf),
    getRentalStateCounts(asOf),
  ]);

  return (
    <RentalsClient page={page} counts={counts} canManage={canManageRentals(user.capabilities)} />
  );
}
