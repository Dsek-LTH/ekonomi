import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings, canViewBookkeeping } from "@/lib/domain/permissions";
import { getTemplate } from "@/lib/data/closing-checklist";
import TemplateClient from "./template-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("closingTemplate");

// The bokslut handbook: the steps every year's checklist starts from.
export default async function ClosingTemplatePage() {
  const user = await requirePage(canViewBookkeeping);
  return (
    <TemplateClient items={await getTemplate()} canEdit={canAccessSettings(user.capabilities)} />
  );
}
