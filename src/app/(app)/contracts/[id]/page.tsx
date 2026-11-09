import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewRentals } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContract } from "@/lib/data/contracts";
import { today } from "@/lib/domain/date";
import { ContractClient } from "./contract-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("contract");

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canViewRentals);

  // Out of scope renders the same not-found as a contract that never existed, so its existence does not leak.
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
