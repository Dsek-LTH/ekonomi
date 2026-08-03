import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { CostCentersClient } from "./cost-centers-client";

export default async function AdminCostCentersPage() {
  const user = await requirePage(canAccessSettings);
  const t = await getTranslations("admin.costCenters");

  const [costCenters, fortnox] = await Promise.all([
    getCostCenters(),
    getFortnoxStatus(user.id),
  ]);

  return (
    <PageShell
      title={t("title")}
      description={t("description")}
      width="content"
    >
      <CostCentersClient costCenters={costCenters} connected={fortnox.connected} />
    </PageShell>
  );
}
