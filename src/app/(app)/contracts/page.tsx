import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewContracts } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContractPage } from "@/lib/data/contracts";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { today } from "@/lib/domain/date";
import { ContractsClient } from "./contracts-client";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The archive list is for whoever may read the archive. An uthyrningsansvarig
  // has /uthyrning, which is the same rows read for their job, and sending them
  // here would be a second list showing them the subset they already have.
  //
  // The scope is still applied underneath, because a gate is a decision about a
  // page and this is a decision about rows.
  const user = await requirePage(canViewContracts);
  const query = parseListQuery(await searchParams);
  const page = await getContractPage(query, contractScopeOf(user));

  return (
    <ContractsClient
      page={page}
      // Expiry is derived rather than stored (lib/contract/status.ts), so the
      // day it is derived against has to come from somewhere. The server's, in
      // the section's timezone, decided once for the whole page: letting each
      // row ask the browser would mean a list that disagrees with itself if it
      // is left open over midnight.
      today={today()}
      canManage={canManageContracts(user.capabilities)}
    />
  );
}
