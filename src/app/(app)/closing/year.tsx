import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/ui/empty-state";
import { getClosingYear, type ClosingYear } from "@/lib/data/closing";
import { getFiscalYear } from "@/lib/server/fiscal-year";

/**
 * The bokslut being looked at: the header's räkenskapsår, the same year every
 * other page is looked at in. It used to be in the path (/closing/[year]),
 * behind a list of years to pick it from, which was a second year picker.
 * See docs/navigation.md.
 *
 * Null before any year has been synced from Fortnox.
 */
export async function getOpenClosingYear(): Promise<ClosingYear | null> {
  const fiscal = await getFiscalYear();
  return fiscal ? getClosingYear(fiscal.id) : null;
}

/** What Bokslut says while there is no year to close. */
export async function NoClosingYear() {
  const t = await getTranslations("closing");
  return <EmptyState title={t("years.empty")} />;
}
