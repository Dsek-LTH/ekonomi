import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getCounterpartyRows } from "@/lib/data/counterparties";
import { CounterpartiesClient } from "./counterparties-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("counterparties");

// Dokument → Motparter: organisations and people the section has agreed with, so a new contract can pick one. The
// section's own side is a constant (lib/contract/section.ts). canManageRentals, not canManageContracts: it means
// RENTAL_MANAGE or CONTRACT_MANAGE, the union of everyone who files a contract.
export default async function CounterpartiesPage() {
  await requirePage(canManageRentals);
  const t = await getTranslations("contracts.counterparties");

  return (
    <PageShell title={t("title")}>
      <CounterpartiesClient counterparties={await getCounterpartyRows()} />
    </PageShell>
  );
}
