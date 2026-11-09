import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings, canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getChecklist } from "@/lib/data/closing-checklist";
import ChecklistClient from "./checklist-client";
import { NoClosingYear, getOpenClosingYear } from "./year";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("closing");

// Bokslut for the header's räkenskapsår, opened on its checklist. Readable by the treasury and the revisorer.
export default async function ClosingPage() {
  const user = await requirePage(canViewBookkeeping);
  const year = await getOpenClosingYear();
  if (!year) return <NoClosingYear />;

  return (
    <ChecklistClient
      year={year}
      items={await getChecklist(year)}
      canWork={canBookkeep(user.capabilities)}
      canEditTemplate={canAccessSettings(user.capabilities)}
    />
  );
}
