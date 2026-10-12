import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getRentalItemRows } from "@/lib/data/rental-items";
import { RentalItemsClient } from "./rental-items-client";

// Under Uthyrning rather than under Inställningar, which is where this started
// and was the wrong side of a line this app already draws. Inställningar → Lager
// holds "konton och inställningar för lagerbokföringen" and nothing else, while
// the products themselves live in /stock, because a catalogue of the section's
// things is not configuration of the app. The same is true here.
//
// RENTAL_MANAGE, the same capability as drawing a contract: the people who
// write uthyrningsavtal are the ones who know what a speaker costs to replace.
// Not CONTRACT_MANAGE, which would hand the catalogue to whoever files
// sponsoravtal and withhold it from whoever runs uthyrningen.
export default async function AdminRentalItemsPage() {
  await requirePage(canManageRentals);
  const t = await getTranslations("contracts.items");

  return (
    <PageShell title={t("title")}>
      <RentalItemsClient items={await getRentalItemRows()} />
    </PageShell>
  );
}
