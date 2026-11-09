import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { getClosingYear, type ClosingYear } from "@/lib/data/closing";
import { getFiscalYear } from "@/lib/server/fiscal-year";

/** The bokslut being looked at: the header's räkenskapsår (docs/navigation.md). Null before any year is synced. */
export async function getOpenClosingYear(): Promise<ClosingYear | null> {
  const fiscal = await getFiscalYear();
  return fiscal ? getClosingYear(fiscal.id) : null;
}

export async function NoClosingYear() {
  const t = await getTranslations("closing");
  return <EmptyState title={t("years.empty")} />;
}
