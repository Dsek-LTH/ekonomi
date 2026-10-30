import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getAccounts, getBookkeepingSettings } from "@/lib/data/accounts";
import { getCostCenterSyncStatus } from "@/lib/data/cost-centers";
import { getFortnoxStatus, getFortnoxSyncStatus, getSupplierSyncStatus } from "@/lib/data/fortnox";
import { getProjectSyncStatus } from "@/lib/data/projects";
import { getLedgerYears } from "@/lib/ledger";
import { FortnoxClient } from "./fortnox-client";

export default async function AdminFortnoxPage() {
  const user = await requirePage(canAccessSettings);

  const [fortnox, accounts, settings, ledgerYears, costCenters, projects, suppliers, lastSync] = await Promise.all([
    getFortnoxStatus(user.id),
    getAccounts(),
    getBookkeepingSettings(),
    getLedgerYears(),
    getCostCenterSyncStatus(),
    getProjectSyncStatus(),
    getSupplierSyncStatus(),
    getFortnoxSyncStatus(),
  ]);

  return (
    <PageShell title="Fortnox">
      <FortnoxClient
        fortnox={fortnox}
        accounts={accounts}
        settings={settings}
        ledgerYears={ledgerYears}
        costCenters={costCenters}
        projects={projects}
        suppliers={suppliers}
        lastSync={lastSync}
      />
    </PageShell>
  );
}
