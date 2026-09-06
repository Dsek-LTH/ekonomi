import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageContracts, canViewContracts } from "@/lib/domain/permissions";
import { getContract } from "@/lib/data/contracts";
import { today } from "@/lib/domain/date";
import { ContractClient } from "./contract-client";

export default async function ContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePage(canViewContracts);

  const contract = await getContract(id);
  if (!contract) notFound();

  return (
    <ContractClient
      contract={contract}
      today={today()}
      canManage={canManageContracts(user.capabilities)}
    />
  );
}
