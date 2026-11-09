// Where `notFound()` lands inside the app. Inside `(app)` so it keeps the sidebar.

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
