// Where `notFound()` lands inside the app — a budget id that no longer exists,
// a mistyped path under /expenses.
//
// Inside `(app)` so it keeps the sidebar: not finding one thing is not a reason
// to lose the way to everything else. Next's stock 404 had no shell, no
// language and no link back.

import { getTranslations } from "next-intl/server";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default async function AppNotFound() {
  const t = await getTranslations("errorPage");

  return (
    <EmptyState
      title={t("notFoundTitle")}
      description={t("notFoundDescription")}
      action={<ButtonLink href="/dashboard">{t("home")}</ButtonLink>}
    />
  );
}
