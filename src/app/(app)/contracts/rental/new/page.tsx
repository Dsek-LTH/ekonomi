import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getRentalItemOptions } from "@/lib/data/rental-items";
import { getSignatories } from "@/lib/data/users";
import { NewRentalClient } from "./new-rental-client";

export default async function NewRentalPage() {
  const user = await requirePage(canManageRentals);

  const [items, signatories] = await Promise.all([getRentalItemOptions(), getSignatories()]);

  return (
    <NewRentalClient
      items={items}
      // Who may bind the section, from the FIRMATECKNARE capability. A picker
      // rather than a default, because the person drawing a rental contract is
      // usually not one of them.
      signatories={signatories.map((s) => ({ id: s.id, name: s.name }))}
      // Pre-selected only when the person drawing it happens to hold it, which
      // is the common case for the skattmästare and nobody else.
      defaultSignatoryId={
        signatories.some((s) => s.id === user.id) ? user.id : ""
      }
    />
  );
}
