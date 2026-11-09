import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getIncomeConfig } from "@/lib/data/income-config";
import { getResultUnits } from "@/lib/data/result-units";
import { canAccessSettings } from "@/lib/domain/permissions";
import { zettleConfigured } from "@/lib/income/zettle-client";
import { incomeSetupSteps } from "@/lib/income/setup";
import { requirePage } from "@/lib/server/current-user";

import { IncomeSettingsClient } from "./income-settings-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("salesSettings");

export default async function AdminIncomePage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.income");

  const [config, resultUnits, setup] = await Promise.all([
    getIncomeConfig(),
    getResultUnits(),
    incomeSetupSteps(),
  ]);

  const assigned = [
    ...resultUnits.flatMap((u) =>
      u.income?.defaultCostCenterCode ? [u.income.defaultCostCenterCode] : [],
    ),
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
        serviceConfigured={zettleConfigured()}
      />
    </PageShell>
  );
}
