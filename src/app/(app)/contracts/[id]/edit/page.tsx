import { notFound, redirect } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { contractScopeOf } from "@/lib/data/contract-scope";
import { getContract } from "@/lib/data/contracts";
import { getRentalItemOptions } from "@/lib/data/rental-items";
import { getCounterpartyOptions } from "@/lib/data/counterparties";
import { canEditRental } from "@/lib/contract/status";
import { NewRentalClient } from "../../rental/new/new-rental-client";

// Editing a rental reuses the form it was drawn on, pre-filled from it, the
// same way an utlägg is edited (expenses/[id]/edit). One form means the two
// screens cannot disagree about what a rental is made of.
export default async function EditRentalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePage(canManageRentals);

  const [contract, items, counterparties] = await Promise.all([
    getContract(id, contractScopeOf(user)),
    getRentalItemOptions(),
    getCounterpartyOptions(),
  ]);

  if (!contract) notFound();
  // Only a rental has this form, and only until its signed copy is uploaded. The
  // contract's own page is where anybody arriving too late belongs.
  if (!contract.rental || !canEditRental(contract)) {
    redirect(`/contracts/${contract.id}`);
  }

  return <NewRentalClient items={items} counterparties={counterparties} existing={contract} />;
}
