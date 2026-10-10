import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canAccessSettings } from "@/lib/domain/permissions";
import { getRoleHolders } from "@/lib/data/users";
import { UsersClient } from "./users-client";

export default async function AdminUsersPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.users");

  // Only the members who hold a role beyond the baseline; anyone else is found
  // through the search, which queries the server.
  const holders = await getRoleHolders();

  return (
    <PageShell title={t("title")}>
      <UsersClient holders={holders} />
    </PageShell>
  );
}
