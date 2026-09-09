import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canManageRentals } from "@/lib/domain/permissions";
import { getCounterpartyRows } from "@/lib/data/counterparties";
import { CounterpartiesClient } from "./counterparties-client";

// Dokument → Motparter. The organisations and people the section has agreed
// with before, so a new contract can pick one rather than have its
// counterparty fields typed in again. See lib/contract/section.ts for why
// the section's own side of a contract is not here too: it is the one party
// that never changes, so it is a constant in the code rather than a row a
// person maintains.
//
// canManageRentals rather than canManageContracts, the same choice
// rental-items/page.tsx makes for the gear catalogue: it already means "has
// RENTAL_MANAGE or CONTRACT_MANAGE", which is the union of everyone who
// files a contract from either door, and CONTRACT_MANAGE alone still passes.
export default async function CounterpartiesPage() {
  await requirePage(canManageRentals);
  const t = await getTranslations("contracts.counterparties");

  return (
    <PageShell title={t("title")} description={t("description")}>
      <CounterpartiesClient counterparties={await getCounterpartyRows()} />
    </PageShell>
  );
}
