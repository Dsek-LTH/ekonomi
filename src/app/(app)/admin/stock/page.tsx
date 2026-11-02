import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { getStockSettings } from "@/lib/data/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";

import { StockSettingsClient } from "./stock-settings-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockSettings");

export default async function AdminStockPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.stock");

  return (
    <PageShell title={t("title")}>
      <StockSettingsClient settings={await getStockSettings()} />
    </PageShell>
  );
}
