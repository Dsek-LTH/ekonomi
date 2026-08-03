import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getResultUnits, getUnassignedCostCenters } from "@/lib/data/result-units";
import { getUsers } from "@/lib/data/users";
import { ResultUnitsClient } from "./result-units-client";

export default async function AdminResultUnitsPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.resultUnits");

  const [resultUnits, users, unassigned] = await Promise.all([
    getResultUnits(),
    getUsers(),
    getUnassignedCostCenters(),
  ]);

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
    >
      <ResultUnitsClient
        resultUnits={resultUnits}
        users={users}
        unassigned={unassigned}
      />
    </PageShell>
  );
}
