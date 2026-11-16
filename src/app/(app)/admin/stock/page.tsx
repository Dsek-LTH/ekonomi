import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { getActiveAccounts } from "@/lib/data/accounts";
import { getCostCenters } from "@/lib/data/cost-centers";
import { getAllStockSettings, getPlaceSettings } from "@/lib/data/stock-settings";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { getConnection } from "@/lib/fortnox";

import { StockSettingsClient } from "./stock-settings-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockSettings");

export default async function AdminStockPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.stock");

  const stocks = await getAllStockSettings();
  // Every account already chosen stays on offer even if Fortnox has since retired it.
  const chosen = stocks.flatMap((s) => [
    s.purchaseOffsetAccount,
    s.boardCostAccount,
    s.boardSalesAccount,
    ...s.groups.flatMap((g) => [
      g.stockAccount,
      g.consumptionAccount,
      g.lossAccount,
      g.countDiffAccount,
    ]),
  ]);
  const [accounts, costCenters, connection, places] = await Promise.all([
    getActiveAccounts(chosen),
    getCostCenters(),
    getConnection(),
    getPlaceSettings(),
  ]);

  return (
    <PageShell title={t("title")}>
      <StockSettingsClient
        stocks={stocks}
        accounts={accounts}
        // Only what Fortnox has and has active can travel on a voucher row, plus whatever is already chosen.
        costCenters={costCenters.filter((c) => c.active)}
        defaultSeries={connection?.voucherSeries ?? null}
        places={places.places}
        knownGroups={places.knownGroups}
      />
    </PageShell>
  );
}
