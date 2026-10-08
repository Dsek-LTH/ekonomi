import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getIncomeConfig } from "@/lib/data/income-config";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";

import { IncomeSettingsClient } from "./income-settings-client";

export default async function AdminIncomePage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.income");

  const config = await getIncomeConfig();

  // Cost centres a verksamhet already points at stay offered even once retired,
  // so retiring one does not make its settings unsaveable.
  const assigned = config.units
    .map((u) => u.income?.defaultCostCenterCode)
    .filter((c): c is string => Boolean(c));
  // Likewise the accounts the settings point at, so a retired one still shows
  // as what it is rather than as an empty picker.
  const { zettleClearingAccount, swishClearingAccount, zettleFeeAccount } = config.settings;
  const [costCenters, accounts] = await Promise.all([
    getActiveCostCenters(assigned),
    getActiveAccounts([zettleClearingAccount, swishClearingAccount, zettleFeeAccount]),
  ]);

  return (
    <PageShell title={t("title")} description={t("description")}>
      <IncomeSettingsClient config={config} costCenters={costCenters} accounts={accounts} />
    </PageShell>
  );
}
