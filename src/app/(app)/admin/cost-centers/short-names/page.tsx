import { getCostCenters } from "@/lib/data/cost-centers";
import { suggestShortName } from "@/lib/domain/cost-center-short-name";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";
import { ShortNamesClient, type Suggestion } from "./short-names-client";

export const generateMetadata = titled("costCenters");

export default async function AdminShortNamesPage() {
  await requirePage(canAccessSettings);
  const costCenters = await getCostCenters();
  const suggestions: Suggestion[] = costCenters.flatMap((cc) => {
    if (cc.shortName) return [];
    const shortName = suggestShortName(cc.name, cc.resultUnit);
    return shortName ? [{ cc, shortName }] : [];
  });

  return <ShortNamesClient suggestions={suggestions} />;
}
