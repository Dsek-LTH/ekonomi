import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
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
  const costCenters = await getActiveCostCenters(assigned);

  return (
    <PageShell title={t("title")} description={t("description")}>
      <IncomeSettingsClient config={config} costCenters={costCenters} />
    </PageShell>
  );
}
