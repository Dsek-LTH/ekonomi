import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { IconChevronRight } from "@/components/ui/icons";
import { SETTINGS_SECTIONS } from "@/components/shell/settings-sections";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("settings");

export default async function AdminPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.index");
  const tNav = await getTranslations("nav");

  return (
    <PageShell title={t("title")}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_SECTIONS.map((s) => (
          <Card key={s.href} className="transition-colors hover:bg-hover">
            <Link href={s.href} className="flex items-start gap-3 p-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-control bg-surface text-muted">
                <s.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{tNav(s.label)}</span>
                <span className="mt-0.5 block text-xs text-muted">{t(`section.${s.blurb}`)}</span>
              </span>
              <IconChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-faint" />
            </Link>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
