import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getRentalItemRows } from "@/lib/data/rental-items";
import { RentalItemsClient } from "./rental-items-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("rentalItems");

// Under Uthyrning, not Inställningar (a catalogue of the section's things is not app configuration). RENTAL_MANAGE, not
// CONTRACT_MANAGE, which would hand the catalogue to whoever files sponsoravtal.
export default async function AdminRentalItemsPage() {
  await requirePage(canManageRentals);
  const t = await getTranslations("contracts.items");

  return (
    <PageShell title={t("title")}>
      <RentalItemsClient items={await getRentalItemRows()} />
    </PageShell>
  );
}
