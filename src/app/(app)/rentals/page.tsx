import { requirePage } from "@/lib/server/current-user";
import { canManageRentals, canViewRentals } from "@/lib/domain/permissions";
import { getRentalPage, getRentalStateCounts } from "@/lib/data/rentals";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { today } from "@/lib/domain/date";
import { RentalsClient } from "./rentals-client";

// Uthyrning: where the gear is, rather than which agreements exist.
//
// The same Contract rows the archive lists, read for a different job. See
// lib/data/rentals.ts for why that is two lists and not two tables.
export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewRentals);

  // "Att göra" rather than "Alla" as the resting tab. Somebody opening this on
  // a Monday wants what is late and what is back but not yet dealt with, and a
  // page that opens on the full history makes them filter to it every time.
  const query = parseListQuery(await searchParams, { defaultTab: "todo" });

  // One day for the whole page: every state on the screen is derived against
  // it, so a list left open over midnight cannot start disagreeing with itself.
  const asOf = today();

  const [page, counts] = await Promise.all([
    getRentalPage(query, asOf),
    getRentalStateCounts(asOf),
  ]);

  return (
    <RentalsClient
      page={page}
      counts={counts}
      canManage={canManageRentals(user.capabilities)}
    />
  );
}
