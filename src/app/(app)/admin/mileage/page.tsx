import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getMileageRateRows } from "@/lib/data/mileage";
import { MileageRatesClient } from "./mileage-client";

export default async function AdminMileagePage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("mileage.rates");

  return (
    <PageShell title={t("title")}>
      <MileageRatesClient rates={await getMileageRateRows()} />
    </PageShell>
  );
}
