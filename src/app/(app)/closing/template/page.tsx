import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings, canViewBookkeeping } from "@/lib/domain/permissions";
import { getTemplate } from "@/lib/data/closing-checklist";
import TemplateClient from "./template-client";

// The bokslut handbook: the steps every year's checklist starts from, and how
// each is done. Kept here rather than under Inställningar, beside the work it
// describes, and kept by whoever keeps Inställningar.
export default async function ClosingTemplatePage() {
  const user = await requirePage(canViewBookkeeping);
  return (
    <TemplateClient items={await getTemplate()} canEdit={canAccessSettings(user.capabilities)} />
  );
}
