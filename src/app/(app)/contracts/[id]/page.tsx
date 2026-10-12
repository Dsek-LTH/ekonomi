import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewRentals } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContract } from "@/lib/data/contracts";
import { today } from "@/lib/domain/date";
import { ContractClient } from "./contract-client";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePage(canViewRentals);

  // Out of scope comes back as null and renders the same not-found as a
  // contract that never existed. Deliberately: telling somebody a sponsoravtal
  // is there but not for them is itself something they were not meant to learn.
  const contract = await getContract(id, contractScopeOf(user));
  if (!contract) notFound();

  return (
    <ContractClient
      contract={contract}
      today={today()}
      canManage={canManageContracts(user.capabilities)}
    />
  );
}
