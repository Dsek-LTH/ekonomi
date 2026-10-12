import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getRentalItemOptions } from "@/lib/data/rental-items";
import { getCounterpartyOptions } from "@/lib/data/counterparties";
import { NewRentalClient } from "./new-rental-client";

export default async function NewRentalPage() {
  await requirePage(canManageRentals);

  const [items, counterparties] = await Promise.all([
    getRentalItemOptions(),
    getCounterpartyOptions(),
  ]);

  return <NewRentalClient items={items} counterparties={counterparties} />;
}
