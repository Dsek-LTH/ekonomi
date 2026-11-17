import { getTranslations } from "next-intl/server";
import { PageShell } from "@/components/page-shell";
import { requirePage } from "@/lib/server/current-user";
import { canSeeUsers } from "@/lib/domain/permissions";
import { getRoleHolders } from "@/lib/data/users";
import { UsersClient } from "./users-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("users");

export default async function AdminUsersPage() {
  await requirePage(canSeeUsers);
  const t = await getTranslations("admin.users");

  const holders = await getRoleHolders();

  return (
    <PageShell title={t("title")}>
      <UsersClient holders={holders} />
    </PageShell>
  );
}
