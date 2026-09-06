import { requirePage } from "@/lib/server/current-user";
import { canManageContracts } from "@/lib/domain/permissions";
import { getContractTags } from "@/lib/data/contracts";
import { NewContractClient } from "./new-client";

export default async function NewContractPage() {
  await requirePage(canManageContracts);

  // The vocabulary the section already uses, so filing the tenth contract
  // reaches for the same words as the first rather than inventing "ljudanl"
  // beside "ljud".
  return <NewContractClient knownTags={await getContractTags()} />;
}
