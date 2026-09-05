import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { PageShell } from "@/components/page-shell";
import { Card } from "@/components/ui/card";
import { IconChevronRight } from "@/components/ui/icons";
import { SETTINGS_SECTIONS } from "@/components/shell/settings-sections";
import { canAccessSettings } from "@/lib/domain/permissions";
import { requirePage } from "@/lib/server/current-user";

// Where Inställningar opens.
//
// It was a redirect to /admin/fortnox, on the reasoning that the sidebar lists
// the sections so an index had nothing to add. That holds at a width where
// there is a sidebar. On a phone there is not: tapping Inställningar dropped
// you on the Fortnox connection whatever you had come for, and reaching Roller
// meant opening the menu a second time, four taps for a thing that should take
// three. The middle screen now shows what there is.
//
// The list is the sidebar's own (components/shell/settings-sections), so the
// two cannot come to disagree about what settings consists of. The one thing
// added here is a line per section: the rail has no room for it, and "Intäkter"
// and "Resultatenheter" are not names that explain themselves to somebody who
// has not already been told.
export default async function AdminPage() {
  await requirePage(canAccessSettings);
  const t = await getTranslations("admin.index");
  const tNav = await getTranslations("nav");

  return (
    <PageShell title={t("title")} description={t("description")}>
      {/* Two up from sm and three from lg. Not `sm:grid-cols-3`: with the nav
          rail and a settings sidebar beside it, three cards in this column are
          narrower than the sentence each one carries. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SETTINGS_SECTIONS.map((s) => (
          <Card key={s.href} className="transition-colors hover:bg-surface">
            {/* The link fills the card, so the whole card is the target rather
                than the words in it. `block` and padding here rather than on
                the Card, which draws the border and nothing else. */}
            <Link href={s.href} className="flex items-start gap-3 p-4">
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-muted">
                <s.icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{tNav(s.label)}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  {t(`section.${s.blurb}`)}
                </span>
              </span>
              <IconChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted/60" />
            </Link>
          </Card>
        ))}
      </div>
    </PageShell>
  );
}
