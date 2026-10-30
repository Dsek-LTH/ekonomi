import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getIncomeConfig } from "@/lib/data/income-config";
import { getResultUnits } from "@/lib/data/result-units";
import { canAccessSettings } from "@/lib/domain/permissions";
import { intaktConfigured } from "@/lib/income/client";
import { incomeSetupSteps } from "@/lib/income/setup";
import { requirePage } from "@/lib/server/current-user";

import { IncomeSettingsClient } from "./income-settings-client";

// Inställningar → Försäljning: everything income needs, on one page and in the
// order it is set up. See income-settings-client.tsx.
export default async function AdminIncomePage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.income");

  const [config, resultUnits, setup] = await Promise.all([
    getIncomeConfig(),
    getResultUnits(),
    incomeSetupSteps(),
  ]);

  // Cost centres something here already points at stay offered even once
  // retired, so retiring one does not make its settings unsaveable. Likewise
  // the accounts, so a retired one still shows as what it is rather than as an
  // empty picker.
  const assigned = [
    ...resultUnits.flatMap((u) => (u.income?.defaultCostCenterCode ? [u.income.defaultCostCenterCode] : [])),
    ...(config.settings.zettleFeeCostCenterCode ? [config.settings.zettleFeeCostCenterCode] : []),
  ];
  const { zettleClearingAccount, swishClearingAccount, zettleFeeAccount } = config.settings;
  const [costCenters, accounts] = await Promise.all([
    getActiveCostCenters(assigned),
    getActiveAccounts([zettleClearingAccount, swishClearingAccount, zettleFeeAccount]),
  ]);

  return (
    <PageShell title={t("title")}>
      <IncomeSettingsClient
        config={config}
        resultUnits={resultUnits}
        costCenters={costCenters}
        accounts={accounts}
        setup={setup}
        serviceConfigured={intaktConfigured()}
      />
    </PageShell>
  );
}
