import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContract } from "@/lib/data/contracts";
import { getRentalItemOptions } from "@/lib/data/rental-items";
import { getCounterpartyOptions } from "@/lib/data/counterparties";
import { canEditRental } from "@/lib/contract/status";
import { NewRentalClient } from "../../rental/new/new-rental-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("editContract");

// Editing a rental reuses the form it was drawn on, pre-filled (as expenses/[id]/edit does).
export default async function EditRentalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canManageRentals);

  const [contract, items, counterparties] = await Promise.all([
    getContract(id, contractScopeOf(user)),
    getRentalItemOptions(),
    getCounterpartyOptions(),
  ]);

  if (!contract) notFound();
  // Only a rental has this form, and only until its signed copy is uploaded.
  if (!contract.rental || !canEditRental(contract)) {
    redirect(`/contracts/${contract.id}`);
  }

  return <NewRentalClient items={items} counterparties={counterparties} existing={contract} />;
}
