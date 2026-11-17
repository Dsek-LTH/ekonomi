import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { SettingsStack } from "@/components/settings/settings-card";
import { SettingsForm } from "@/components/settings/settings-draft";
import { getAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getMileageRateRows } from "@/lib/data/mileage";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";
import { BookingCard } from "./booking-card";
import { MileageRatesClient } from "./mileage-client";

export const generateMetadata = titled("expenseSettings");

// Everything about utlägg that is set rather than done: how they are booked, and what a kilometre is worth.
export default async function AdminExpensesPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.expenses");
  const [settings, accounts, rates] = await Promise.all([
    getBookkeepingSettings(),
    getAccounts(),
    getMileageRateRows(),
  ]);

  return (
    <PageShell title={t("title")}>
      <SettingsForm>
        <SettingsStack>
          <BookingCard settings={settings} accounts={accounts} />
          <MileageRatesClient rates={rates} />
        </SettingsStack>
      </SettingsForm>
    </PageShell>
  );
}
