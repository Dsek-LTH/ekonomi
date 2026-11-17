"use client";

import { useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { IconChevronLeft, IconX } from "@/components/ui/icons";
import {
  SETTINGS_GROUPS,
  SETTINGS_ROOT,
  sectionOf,
  type SettingsSectionGroup,
} from "@/components/shell/settings-sections";
import { useRole } from "@/components/shell/role-context";
import { canAccessSettings } from "@/lib/domain/permissions";
import { useGoBack } from "@/components/shell/route-history";
import { useProgressRouter } from "@/components/shell/route-progress";
import { SettingsTitleSlot } from "@/components/shell/settings-title";
import {
  SettingsDirtyCtx,
  SettingsFooterSlot,
  useConfirmLeave,
} from "@/components/settings/settings-draft";
import { cn } from "@/lib/ui/utils";

export default function SettingsOverlayLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tAdmin = useTranslations("admin.index");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useProgressRouter();
  const backToApp = useGoBack("/dashboard");
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const { user } = useRole();
  // A settings page with unsaved changes says so here (SettingsForm), so closing the overlay can ask first. Links
  // are asked about by the page's own leave guard.
  const [dirty, setDirty] = useState(false);
  const confirmLeave = useConfirmLeave();
  const close = async () => {
    if (dirty && !(await confirmLeave())) return;
    backToApp.goBack();
  };

  // Somebody who may give access but not run the settings sees only Användare (docs/settings.md).
  const groups: SettingsSectionGroup[] = canAccessSettings(user.capabilities)
    ? SETTINGS_GROUPS
    : SETTINGS_GROUPS.map((g) => ({
        ...g,
        sections: g.sections.filter((s) => s.href === "/admin/users"),
      })).filter((g) => g.sections.length > 0);
  const first = groups[0]?.sections[0]?.href ?? "/admin/users";

  // From sm the sidebar lists the sections, so the /admin grid is replaced before paint.
  const atRoot = pathname === SETTINGS_ROOT;
  // A record under a section (`/admin/users/[id]`) has its own back arrow in the bar, to the section's list.
  const section = sectionOf(pathname);
  const atRecord = section !== null && pathname !== section.href;
  useLayoutEffect(() => {
    if (atRoot && window.matchMedia("(min-width: 640px)").matches) {
      router.replace(first);
    }
  }, [atRoot, router, first]);

  // Replace rather than push so Back leaves settings in one press. Modified or non-left clicks must reach the real href.
  const switchSection = (href: string) => (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    router.replace(href);
  };

  return (
    <Modal variant="large" label={tAdmin("title")} onClose={() => void close()}>
      <div className="flex h-full min-h-0">
        <nav
          aria-label={t("settings")}
          className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-3 pb-3 sm:flex"
        >
          <p className="-mx-3 mb-2 flex h-14 shrink-0 items-center border-b border-border px-6 text-sm font-semibold">
            {t("settings")}
          </p>
          {groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-0.5 pb-3">
              <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted">
                {tAdmin(`group.${g.label}`)}
              </p>
              {g.sections.map((s) => {
                const Icon = s.icon;
                const active = section?.href === s.href;
                return (
                  <Link
                    key={s.href}
                    href={s.href}
                    onClick={switchSection(s.href)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors",
                      active
                        ? "bg-accent-soft font-semibold text-accent"
                        : "text-foreground hover:bg-hover",
                    )}
                  >
                    <Icon className="size-[18px] shrink-0" />
                    {t(s.label)}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:px-8">
            {!atRoot && !atRecord && (
              <Link
                href={SETTINGS_ROOT}
                onClick={switchSection(SETTINGS_ROOT)}
                aria-label={t("settings")}
                className="-ml-2 flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground sm:hidden"
              >
                <IconChevronLeft className="size-5" />
              </Link>
            )}
            <div ref={setTitleSlot} className="min-w-0 flex-1" />
            <Link
              href={backToApp.href}
              onClick={backToApp.onClick}
              aria-label={tCommon("close")}
              className="flex size-9 shrink-0 items-center justify-center rounded-control text-muted transition-colors hover:bg-hover hover:text-foreground"
            >
              <IconX className="size-5" />
            </Link>
          </header>

          <div className="mx-auto w-full flex-1 px-4 py-6 sm:px-8">
            <div className={cn(atRoot && "sm:hidden")}>
              <SettingsDirtyCtx.Provider value={setDirty}>
                <SettingsTitleSlot.Provider value={titleSlot}>
                  <SettingsFooterSlot.Provider value={footerSlot}>
                    {children}
                  </SettingsFooterSlot.Provider>
                </SettingsTitleSlot.Provider>
              </SettingsDirtyCtx.Provider>
            </div>
          </div>

          {/* A page's save bar (SettingsForm) lands here: under the content, which grows to fill the column, so the
          bar is at the bottom of the overlay on a short page and sticks there on a long one. Empty, it takes no room. */}
          <div ref={setFooterSlot} className="sticky bottom-0 z-10 shrink-0 empty:hidden" />
        </div>
      </div>
    </Modal>
  );
}
