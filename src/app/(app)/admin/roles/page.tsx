import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getAuthority } from "@/lib/data/authority";
import { RolesClient } from "./roles-client";

export default async function AdminRolesPage() {
  const user = await requirePage(canAccessSettings);
  const t = await getTranslations("admin.roles");
  const authority = await getAuthority();

  return (
    <PageShell title={t("title")} description={t("description")}>
      <RolesClient
        {...authority}
        // Which roles the reader themselves holds. The screen uses it for one
        // thing: warning before they save a change that takes something away
        // from a role of their own. Editing your own authority is allowed —
        // somebody has to be able to — but it should not be possible to do by
        // accident while tidying a grid.
        viewerRoles={user.roles}
      />
    </PageShell>
  );
}
