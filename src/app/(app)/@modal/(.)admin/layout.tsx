"use client";

import { useLayoutEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Modal } from "@/components/ui/modal";
import { IconChevronLeft, IconX } from "@/components/ui/icons";
import { SETTINGS_SECTIONS, SETTINGS_ROOT } from "@/components/shell/settings-sections";
import { useGoBack } from "@/components/shell/route-history";
import { useProgressRouter } from "@/components/shell/route-progress";
import { SettingsTitleSlot } from "@/components/shell/settings-title";
import { cn } from "@/lib/ui/utils";

export default function SettingsOverlayLayout({ children }: { children: React.ReactNode }) {
  const t = useTranslations("nav");
  const tAdmin = useTranslations("admin.index");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useProgressRouter();
  const backToApp = useGoBack("/dashboard");
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  // From sm the sidebar lists the sections, so the /admin grid is replaced before paint.
  const atRoot = pathname === SETTINGS_ROOT;
  useLayoutEffect(() => {
    if (atRoot && window.matchMedia("(min-width: 640px)").matches) {
      router.replace(SETTINGS_SECTIONS[0].href);
    }
  }, [atRoot, router]);

  // Replace rather than push so Back leaves settings in one press. Modified or non-left clicks must reach the real href.
  const switchSection = (href: string) => (e: React.MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    router.replace(href);
  };

  return (
    <Modal variant="large" label={tAdmin("title")} onClose={backToApp.goBack}>
      <div className="flex h-full min-h-0">
        <nav
          aria-label={t("settings")}
          className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border px-3 pb-3 sm:flex"
        >
          <p className="-mx-3 mb-2 flex h-14 shrink-0 items-center border-b border-border px-6 text-sm font-semibold">
            {t("settings")}
          </p>
          {SETTINGS_SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = pathname === s.href;
            return (
              <Link
                key={s.href}
                href={s.href}
                onClick={switchSection(s.href)}
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
        </nav>

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-4 sm:px-8">
            {!atRoot && (
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
              <SettingsTitleSlot.Provider value={titleSlot}>{children}</SettingsTitleSlot.Provider>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
