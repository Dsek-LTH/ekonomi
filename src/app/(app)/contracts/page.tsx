import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewContracts } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContractPage } from "@/lib/data/contracts";
import { parseListQuery, type SearchParams } from "@/lib/data/list-query";
import { today } from "@/lib/domain/date";
import { ContractsClient } from "./contracts-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("contracts");

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // The archive list is for whoever may read the archive (uthyrningsansvariga use /rentals). The scope is still applied
  // underneath: a gate decides on a page, the scope on rows.
  const user = await requirePage(canViewContracts);
  const query = parseListQuery(await searchParams);
  const page = await getContractPage(query, contractScopeOf(user));

  return (
    <ContractsClient
      page={page}
      // Expiry is derived (lib/contract/status.ts) against one server-side `today` in the section's timezone, so the list
      // cannot disagree with itself over midnight.
      today={today()}
      canManage={canManageContracts(user.capabilities)}
    />
  );
}
