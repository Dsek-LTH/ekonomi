import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings, canBookkeep, canViewBookkeeping } from "@/lib/domain/permissions";
import { getClosingYear } from "@/lib/data/closing";
import { getChecklist } from "@/lib/data/closing-checklist";
import ChecklistClient from "./checklist-client";

// A year's bokslut, opened on its checklist: what is left to do, how to do it,
// and what last year's skattmästare wanted this one to know.
export default async function ClosingYearPage({ params }: { params: Promise<{ year: string }> }) {
  const user = await requirePage(canViewBookkeeping);
  const id = Number((await params).year);
  const year = Number.isInteger(id) ? await getClosingYear(id) : null;
  if (!year) notFound();

  return (
    <ChecklistClient
      year={year}
      items={await getChecklist(year)}
      canWork={canBookkeep(user.capabilities)}
      canEditTemplate={canAccessSettings(user.capabilities)}
    />
  );
}
