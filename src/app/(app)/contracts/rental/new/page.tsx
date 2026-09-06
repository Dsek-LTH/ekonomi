import { requirePage } from "@/lib/server/current-user";
import { canManageContracts } from "@/lib/domain/permissions";
import { getContractTags } from "@/lib/data/contracts";
import { getRentalItemOptions } from "@/lib/data/rental-items";
import { NewRentalClient } from "./new-rental-client";

export default async function NewRentalPage() {
  const user = await requirePage(canManageContracts);

  const [items, knownTags] = await Promise.all([getRentalItemOptions(), getContractTags()]);

  return (
    <NewRentalClient
      items={items}
      knownTags={knownTags}
      // The section's signatory is whoever is drawing the contract, and the
      // route writes their name onto the party row itself. Shown here so the
      // form says whose name is about to go on the document rather than
      // revealing it once the PDF is drawn.
      signatoryName={user.name}
    />
  );
}
