import { requirePage } from "@/lib/server/current-user";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { getBankTransactionPage } from "@/lib/data/bank";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import BankClient from "./bank-client";

export default async function BankPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The whole section's bank feed — every purchase, its amount and whose card
  // it sat on. The nav only offers it to bookkeeping, and this is what keeps
  // the route from being reachable by URL regardless. (BankClient hides the
  // import and delete controls behind the same check; that is the second half
  // of the rule, not the first.)
  await requirePage(canAccessBookkeeping);

  const page = await getBankTransactionPage({}, parseListQuery(await searchParams));
  return <BankClient page={page} />;
}
