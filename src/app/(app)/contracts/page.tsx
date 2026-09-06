import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewContracts } from "@/lib/domain/permissions";
import { getContractPage } from "@/lib/data/contracts";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { today } from "@/lib/domain/date";
import { ContractsClient } from "./contracts-client";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await requirePage(canViewContracts);
  const query = parseListQuery(await searchParams);
  const page = await getContractPage(query);

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
