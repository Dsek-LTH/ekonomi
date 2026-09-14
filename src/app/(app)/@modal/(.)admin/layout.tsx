"use client";

// The chrome around every settings section when it opens as an overlay: a
// large Modal (see components/ui/modal.tsx) with the app still visible around
// its edges, an internal list of sections down the side, and a close control.
// Nothing here duplicates a section's own content: every page.tsx under this
// tree is a one-line re-export of the real one at admin/<section>/page.tsx
// (see that file), so this layout is the entire difference between the
// overlay and the standalone route.
//
// The app's own sidebar is not touched by any of this: this whole tree only
// ever mounts inside the @modal slot, a sibling of AppShell rather than
// something inside it, so AppShell's own nav renders exactly as it would with
// no overlay open at all. See (app)/layout.tsx.
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { IconChevronLeft, IconX } from "@/components/ui/icons";
import { SETTINGS_SECTIONS, SETTINGS_ROOT } from "@/components/shell/settings-sections";
import { useBackToApp } from "@/components/shell/route-history";
import { useProgressRouter } from "@/components/shell/route-progress";
import { cn } from "@/lib/ui/utils";

export default function SettingsOverlayLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tAdmin = useTranslations("admin.index");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useProgressRouter();
  const backToApp = useBackToApp("/dashboard");

  // A section switch replaces rather than pushes, so the trip through
  // settings is one history entry deep regardless of how many sections were
  // visited: the browser's own Back button, and not only the close button
  // below, leaves settings in a single press. A modifier or a non-left click
  // is opening the link some other way (a new tab, most often), and that has
  // to reach the real href, unintercepted.
  const switchSection = (href: string) => (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    router.replace(href);
  };

  return (
    <Modal variant="large" label={tAdmin("title")} onClose={backToApp.close}>
      <div className="flex h-full min-h-0">
        {/* The settings sidebar, now confined to the overlay it describes
            rather than standing in for the app's own. Hidden below sm: a
            phone gets the section grid (admin/page.tsx, re-exported as
            (.)admin/page.tsx) instead, the same as it does outside the
            overlay. */}
        <nav
          aria-label={t("settings")}
          className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-3 sm:flex"
        >
          <p className="px-3 pb-3 pt-1 text-sm font-semibold">{t("settings")}</p>
          {SETTINGS_SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                onClick={switchSection(s.href)}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                  active ? "brand-fill text-on-brand" : "text-foreground hover:bg-hover",
                )}
              >
                <Icon className="size-[18px] shrink-0" />
                {t(s.label)}
              </Link>
            );
          })}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 sm:justify-end sm:border-0 sm:bg-transparent">
            {/* Only below sm, and only once there is somewhere to go back to:
                the grid at /admin is the section list's phone equivalent, so
                a section opened from it gets a way back to it. */}
            {pathname !== SETTINGS_ROOT && (
              <Link
                href={SETTINGS_ROOT}
                onClick={switchSection(SETTINGS_ROOT)}
                className="-ml-1 flex items-center gap-1 rounded-lg px-1 py-1.5 text-sm font-medium text-muted transition-colors hover:text-foreground sm:hidden"
              >
                <IconChevronLeft className="size-4" />
                {t("settings")}
              </Link>
            )}
            <span className="flex-1 sm:hidden" />
            <Link
              href={backToApp.href}
              onClick={backToApp.onClick}
              aria-label={tCommon("close")}
              className="flex size-9 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-hover hover:text-foreground"
            >
              <IconX className="size-5" />
            </Link>
          </header>

          <div className="mx-auto w-full flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</div>
        </div>
      </div>
    </Modal>
  );
}
