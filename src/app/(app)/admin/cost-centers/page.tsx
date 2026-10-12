import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getCostCenters } from "@/lib/data/cost-centers";
import { CostCentersClient } from "./cost-centers-client";

export default async function AdminCostCentersPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.costCenters");
  const costCenters = await getCostCenters();

  return (
    <PageShell
      title={t("title")}
      width="content"
    >
      <CostCentersClient costCenters={costCenters} />
    </PageShell>
  );
}
