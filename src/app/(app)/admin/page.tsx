import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { IconChevronRight } from "@/components/ui/icons";
import { SETTINGS_GROUPS } from "@/components/shell/settings-sections";
import { canAccessSettings, canSeeUsers } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("settings");

// The sections as a list, under the sidebar's headings. Only reached on a phone: from sm the overlay opens on the
// first section (docs/settings.md).
export default async function AdminPage() {
  const user = await requirePage(canSeeUsers);
  // Somebody who may give access but not run the settings has one page here.
  if (!canAccessSettings(user.capabilities)) redirect("/admin/users");
  const t = await getTranslations("admin.index");
  const tNav = await getTranslations("nav");

  return (
    <PageShell title={t("title")}>
      <div className="space-y-6">
        {SETTINGS_GROUPS.map((g) => (
          <section key={g.label} className="space-y-2">
            <h2 className="px-1 text-xs font-medium text-muted">{t(`group.${g.label}`)}</h2>
            <Card>
              <ul>
                {g.sections.map((s) => (
                  <li key={s.href} className="border-b border-border last:border-0">
                    <Link
                      href={s.href}
                      className="flex items-center gap-3 px-inset py-3 transition-colors hover:bg-hover"
                    >
                      <s.icon className="size-[18px] shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 text-sm font-medium">{tNav(s.label)}</span>
                      <IconChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        ))}
      </div>
    </PageShell>
  );
}
