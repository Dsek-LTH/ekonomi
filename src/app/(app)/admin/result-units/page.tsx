import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
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

  return (
    <PageShell
      title={t("title")}
    >
      <ResultUnitsClient
        resultUnits={resultUnits}
        unassigned={unassigned}
        incomeEnabled={intaktConfigured()}
      />
    </PageShell>
  );
}
