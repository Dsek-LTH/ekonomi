import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getCards } from "@/lib/data/bank";
import { getResultUnitOptions } from "@/lib/data/result-units";
import { getUsers } from "@/lib/data/users";
import { CardsClient } from "./cards-client";

export default async function AdminCardsPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.cards");

  const [cards, users, resultUnits] = await Promise.all([
    getCards(),
    getUsers(),
    getResultUnitOptions(),
  ]);

  return (
    <PageShell title={t("title")}>
      <CardsClient cards={cards} users={users} resultUnits={resultUnits} />
    </PageShell>
  );
}
