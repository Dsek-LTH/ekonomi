"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { UserAvatar } from "../ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { IconFortnox } from "./fortnox-mark";
import { useGuides } from "./guide";
import { IconCheck, IconChevronRight, IconHelp } from "../ui/icons";
import type { NavGroup, NavItem } from "./app-shell";
import { NavCount } from "./nav-count";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import { useFocusTrap } from "@/lib/ui/focus-trap";
import { cn } from "@/lib/ui/utils";

const CARD =
  "divide-y divide-border overflow-hidden rounded-panel border border-border bg-background";

const ROW = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors";

export function MobileNav({
  open,
  onClose,
  overview,
  groups,
  settings,
  isActive,
  counts,
  user,
  fortnox,
}: {
  open: boolean;
  onClose: () => void;
  overview: NavItem;
  groups: NavGroup[];
  settings: NavItem | null;
  isActive: (href: string) => boolean;
  counts: Record<string, number>;
  user: CurrentUser;
  fortnox?: { session: FortnoxStatus["session"] | null; company: string | null };
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tGuides = useTranslations("guides");
  const pathname = usePathname();
  const { pageGuide, start } = useGuides();

  const boxRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, boxRef);

  const navRow = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onClose}
        aria-current={active ? "page" : undefined}
        className={cn(ROW, "active:bg-surface")}
      >
        <Icon className={cn("size-5 shrink-0", active ? "text-accent" : "text-muted")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            active ? "font-semibold text-accent" : "font-medium text-foreground",
          )}
        >
          {t(item.label)}
        </span>
        {active && <IconCheck aria-hidden className="size-4 shrink-0 text-accent" />}
        {(counts[item.href] ?? 0) > 0 && <NavCount count={counts[item.href]} />}
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
      </Link>
    );
  };

  return (
    <div
      ref={boxRef}
      inert={!open}
      className={cn(
        "fixed inset-0 z-40 flex flex-col bg-canvas transition-transform duration-200 ease-out md:hidden print:hidden",
        "pt-[env(safe-area-inset-top)]",
        open ? "translate-y-0" : "translate-y-full",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/symbol_rosa.svg" alt="" className="h-7" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">D-sektionen</p>
        <button
          type="button"
          onClick={onClose}
          className="-me-1 rounded-control px-2 py-1.5 text-sm font-semibold text-accent transition-colors active:bg-accent-soft"
        >
          {t("doneMenu")}
        </button>
      </header>

      <nav
        aria-label={t("mainNav")}
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4",
          "pb-[calc(env(safe-area-inset-bottom)+1.5rem)]",
        )}
      >
        <Link
          href="/profile"
          onClick={onClose}
          aria-current={pathname === "/profile" ? "page" : undefined}
          className={cn(CARD, "flex items-center gap-3 px-4 py-3 active:bg-surface")}
        >
          <UserAvatar userId={user.id} name={user.name} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-sm font-medium">{user.name}</span>
            <span className="block truncate text-xs text-muted">{user.email}</span>
          </span>
          <IconChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
        </Link>

        <div className={CARD}>{navRow(overview)}</div>

        {groups.map((group) => (
          <div key={group.label} data-tour={`nav-group:${group.label}`}>
            <p className="mb-1.5 px-4 text-xs font-medium text-muted">{t(group.label)}</p>
            <div className={CARD}>{group.items.map(navRow)}</div>
          </div>
        ))}

        {settings && (
          <div className={CARD} data-tour="nav-settings">
            {navRow(settings)}
          </div>
        )}

        <div>
          <p className="mb-1.5 px-4 text-xs font-medium text-muted">{tGuides("menuHeading")}</p>
          <div className={CARD}>
            {[
              ...(pageGuide && pageGuide.id !== "start" ? [pageGuide.id] : []),
              "start" as const,
            ].map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  onClose();
                  start(id);
                }}
                className={cn(ROW, "text-left active:bg-surface")}
              >
                <IconHelp className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  {id === "start" ? tGuides("tour") : tGuides("thisPage")}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className={CARD}>
          {fortnox && (
            // A plain <a>: /api/fortnox/connect redirects out to Fortnox's own consent
            // screen, and routing that through the client router would ask Next to
            // render a page that is never going to arrive.
            <a
              href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(pathname)}`}
              onClick={onClose}
              className={cn(ROW, "active:bg-surface")}
            >
              <IconFortnox className="size-5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {fortnox.session ? t("fortnoxSignedIn") : t("fortnoxSignIn")}
                </span>
                {fortnox.company && (
                  <span className="block truncate text-xs text-muted">{fortnox.company}</span>
                )}
              </span>
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  fortnox.session ? "bg-success" : "bg-warning",
                )}
              />
            </a>
          )}
          <div
            className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5"
            data-tour="theme"
          >
            <span className="text-sm font-medium">{tc("theme")}</span>
            <ThemeToggle />
          </div>
          <div
            className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5"
            data-tour="language"
          >
            <span className="text-sm font-medium">{tc("language")}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </nav>
    </div>
  );
}
