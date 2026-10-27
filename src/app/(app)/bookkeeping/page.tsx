import { requirePage } from "@/lib/server/current-user";
import { canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getExpensePage } from "@/lib/data/expenses";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { getReviewQueue } from "@/lib/data/review-queue";
import BookkeepingClient from "./bookkeeping-client";

export default async function BookkeepingPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewBookkeeping);
  const query = parseListQuery(await searchParams);

  const [page, queue] = await Promise.all([
    // Bookkeeping picks up where approval ends, so that is what the page asks
    // for, rather than everything, cut down to it once it has arrived.
    getExpensePage(user, { kind: "signed" }, query),
    // How many konterade utlägg this viewer may bokföra, for the way into the
    // review. Bokföring happens there and nowhere else. A reader (a revisor)
    // bokför nothing, so is offered no way in.
    canBookkeep(user.capabilities) ? getReviewQueue(user) : null,
  ]);
  return <BookkeepingClient page={page} reviewCount={queue?.ids.length ?? 0} />;
}
