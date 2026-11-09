import { requirePage } from "@/lib/server/current-user";
import { canManageContracts } from "@/lib/domain/permissions";
import { getContractTags } from "@/lib/data/contracts";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getCounterpartyOptions } from "@/lib/data/counterparties";
import { UploadContractClient } from "./upload-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("uploadContract");

export default async function UploadContractPage() {
  // Filing an arbitrary agreement is the wide grant; uthyrningsansvariga draw rentals through the rental form.
  const user = await requirePage(canManageContracts);

  // The section's existing vocabulary, so tags do not drift ("ljudanl" beside "ljud").
  return (
    <UploadContractClient
      knownTags={await getContractTags(contractScopeOf(user))}
      counterparties={await getCounterpartyOptions()}
    />
  );
}
