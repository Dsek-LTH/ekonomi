import { requirePage } from "@/lib/server/current-user";
import { canManageContracts } from "@/lib/domain/permissions";
import { getContractTags } from "@/lib/data/contracts";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getCounterpartyOptions } from "@/lib/data/counterparties";
import { UploadContractClient } from "./upload-client";

export default async function UploadContractPage() {
  // Filing an arbitrary agreement is the wide grant. An uthyrningsansvarig
  // draws rentals through the rental form, which is a different page.
  const user = await requirePage(canManageContracts);

  // The vocabulary the section already uses, so filing the tenth contract
  // reaches for the same words as the first rather than inventing "ljudanl"
  // beside "ljud".
  return (
    <UploadContractClient
      knownTags={await getContractTags(contractScopeOf(user))}
      counterparties={await getCounterpartyOptions()}
    />
  );
}
