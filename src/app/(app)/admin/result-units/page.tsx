import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getActiveCostCenters } from "@/lib/data/cost-centers";
import { getResultUnits, getUnassignedCostCenters } from "@/lib/data/result-units";
import { intaktConfigured } from "@/lib/income/client";
import { ResultUnitsClient } from "./result-units-client";

export default async function AdminResultUnitsPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.resultUnits");

  const [resultUnits, unassigned] = await Promise.all([
    getResultUnits(),
    getUnassignedCostCenters(),
  ]);

  // A cost centre a verksamhet already books against stays offered even once
  // retired, so retiring one does not make its settings unsaveable.
  const costCenters = await getActiveCostCenters(
    resultUnits.flatMap((u) => (u.income?.defaultCostCenterCode ? [u.income.defaultCostCenterCode] : [])),
  );

  return (
    <PageShell
      title={t("title")}
    >
      <ResultUnitsClient
        resultUnits={resultUnits}
        unassigned={unassigned}
        costCenters={costCenters}
        incomeEnabled={intaktConfigured()}
      />
    </PageShell>
  );
}
