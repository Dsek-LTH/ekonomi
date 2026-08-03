import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getCards } from "@/lib/data/bank";
import { getUsers } from "@/lib/data/users";
import { CardsClient } from "./cards-client";

export default async function AdminCardsPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.cards");

  const [cards, users] = await Promise.all([getCards(), getUsers()]);

  return (
    <PageShell title={t("title")} description={t("description")}>
      <CardsClient cards={cards} users={users} />
    </PageShell>
  );
}
