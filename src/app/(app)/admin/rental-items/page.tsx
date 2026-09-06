import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canManageContracts } from "@/lib/domain/permissions";
import { getRentalItemRows } from "@/lib/data/rental-items";
import { RentalItemsClient } from "./rental-items-client";

// CONTRACT_MANAGE rather than SETTINGS, though the page sits under
// Inställningar. The catalogue is a list of the section's things, not
// configuration of the app, and the people who write uthyrningsavtal are the
// ones who know what a speaker costs to replace. The nav entry checks the same
// capability, so nobody is offered a link into a redirect.
export default async function AdminRentalItemsPage() {
  await requirePage(canManageContracts);
  const t = await getTranslations("contracts.items");

  return (
    <PageShell title={t("title")} description={t("description")}>
      <RentalItemsClient items={await getRentalItemRows()} />
    </PageShell>
  );
}
