import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getCostCenterSyncStatus } from "@/lib/data/cost-centers";
import { getFortnoxStatus } from "@/lib/data/fortnox";
import { getLedgerYears } from "@/lib/ledger";
import { FortnoxClient } from "./fortnox-client";

export default async function AdminFortnoxPage() {
  const user = await requirePage(canAccessSettings);
  const t = await getTranslations("admin.fortnox");

  const [fortnox, accounts, settings, ledgerYears, costCenters] = await Promise.all([
    getFortnoxStatus(user.id),
    getAccounts(),
    getBookkeepingSettings(),
    getLedgerYears(),
    getCostCenterSyncStatus(),
  ]);

  return (
    <PageShell title="Fortnox" description={t("description")}>
      <FortnoxClient
        fortnox={fortnox}
        accounts={accounts}
        settings={settings}
        ledgerYears={ledgerYears}
        costCenters={costCenters}
      />
    </PageShell>
  );
}
