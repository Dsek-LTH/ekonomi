"use client";

// The navigation on a phone: a screen, not a narrow drawer.
//
// It used to be the same 256px panel the desktop rail opens into, slid over the
// page. On a 390px phone that left a 134px stripe of dimmed page behind it,
// which is not context, because nothing in a 134px stripe can be read. So the
// old drawer was paying for a scrim that showed nothing *and* cramping the menu
// at the same time.
//
// Worse than the width, it was the rail's geometry wearing a different one. The
// panel's rows are measured for a 64px rail (a 40px box with the icon on its
// centre line and the label overflowing to be clipped) and none of that means
// anything at full width. It came out at 40px rows, under the 44px a finger
// wants, because they were never meant for a finger.
//
// So this is its own component rather than a breakpoint on that one. Inset
// grouped lists, the way a phone's own settings are written: a caption, a card,
// 48px rows of icon, label and chevron. What it costs is that the two navs
// share a table and nothing else, which is the right split, because what they
// have in common is *which sections exist*, and everything else about them is
// the difference between a pointer and a thumb.
//
// Kept mounted and slid off the bottom rather than unmounted, so it has a way
// in and a way out to animate; `inert` is what stops a closed menu from holding
// tab stops and swallowing taps. (`prefers-reduced-motion` is answered globally
// in globals.css, so the transition needs no guard of its own.)
import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Avatar } from "../ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { IconFortnox } from "./fortnox-mark";
import { IconCheck, IconChevronLeft, IconChevronRight } from "../ui/icons";
import type { NavGroup, NavItem } from "./app-shell";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import { useFocusTrap } from "@/lib/ui/focus-trap";
import type { Theme } from "@/lib/ui/theme";
import { cn } from "@/lib/ui/utils";

// One card of an inset grouped list. `divide-y` rather than a border per row,
// so the rules stop short of the rounded corners on their own.
const CARD = "divide-y divide-border overflow-hidden rounded-2xl border border-border bg-background";

// 48px, not the rail's 40. Everything on this screen is hit with a thumb, and
// `min-h` rather than `h` so a long section name may take a second line rather
// than being squeezed into one.
const ROW = "flex min-h-12 w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors";

export function MobileNav({
  open,
  onClose,
  overview,
  groups,
  help,
  inSettings,
  isActive,
  user,
  theme,
  fortnox,
}: {
  open: boolean;
  onClose: () => void;
  /** The standalone link above the groups. Absent inside settings. */
  overview: NavItem | null;
  groups: NavGroup[];
  help: NavItem;
  inSettings: boolean;
  isActive: (href: string) => boolean;
  user: CurrentUser;
  theme: Theme;
  fortnox?: { session: FortnoxStatus["session"] | null };
}) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();

  // The open menu covers the page, so Tab stays in it. `inert` already keeps a
  // closed one out of the way; this is the other half, the page behind an open
  // one. See lib/ui/focus-trap.ts.
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
        // `active:` and not `hover:`: a phone has no hover, and the only thing
        // a row has to do on being pressed is look pressed.
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
        {/* Where you are, said twice, in the accent and with a mark. The rail
            says it with a block of brand colour, which needs a whole row to
            itself to read as anything; in a list of cards the same fill would
            be a row that looks selected rather than a place you already are. */}
        {active && <IconCheck aria-hidden className="size-4 shrink-0 text-accent" />}
        <IconChevronRight aria-hidden className="size-4 shrink-0 text-muted/60" />
      </Link>
    );
  };

  return (
    <div
      ref={boxRef}
      // Not `hidden`/`block` on the open state: a menu that is display:none has
      // nothing to slide. It is off the bottom of the screen instead, and inert
      // while it is there so nothing in it can be tabbed to or tapped through.
      inert={!open}
      className={cn(
        "fixed inset-0 z-40 flex flex-col bg-canvas transition-transform duration-200 ease-out md:hidden print:hidden",
        // The status bar's strip, so the header does not start under the clock
        // when this is installed to a home screen.
        "pt-[env(safe-area-inset-top)]",
        open ? "translate-y-0" : "translate-y-full",
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/symbol_rosa.svg" alt="" className="h-7" />
        {/* The brand, which the top bar gave up when it started naming the
            section you are on instead. This is where it still fits. */}
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">
          {inSettings ? t("settings") : "D-sektionen"}
        </p>
        {/* The only way out, now that there is no page showing beside the menu
            to tap on. Escape closes it too, from a keyboard. See AppShell. */}
        <button
          type="button"
          onClick={onClose}
          className="-me-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-accent transition-colors active:bg-accent-soft"
        >
          {t("doneMenu")}
        </button>
      </header>

      <nav
        aria-label={t("mainNav")}
        className={cn(
          "min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-4",
          // The home indicator's strip, plus the room the last card wants below
          // it either way.
          "pb-[calc(env(safe-area-inset-bottom)+1.5rem)]",
        )}
      >
        {inSettings ? (
          // Settings replace the app's nav rather than nesting inside it, so
          // the way back is a row of its own at the top, the same place the
          // rail keeps it.
          <Link href="/dashboard" onClick={onClose} className={cn(CARD, ROW, "active:bg-surface")}>
            <IconChevronLeft aria-hidden className="size-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate font-medium">{t("backToApp")}</span>
          </Link>
        ) : (
          // Whose session this is, at the top, where a phone puts an account.
          // The rail keeps it at the foot because that is where a 64px column
          // has room for an avatar; here there is a whole screen and the first
          // thing worth saying is who you are signed in as.
          <Link
            href="/profile"
            onClick={onClose}
            aria-current={pathname === "/profile" ? "page" : undefined}
            className={cn(CARD, "flex items-center gap-3 px-4 py-3 active:bg-surface")}
          >
            <Avatar initials={user.initials} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{user.name}</span>
              <span className="block truncate text-xs text-muted">{user.email}</span>
            </span>
            <IconChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
          </Link>
        )}

        {overview && <div className={CARD}>{navRow(overview)}</div>}

        {groups.map((group) => (
          <div key={group.label}>
            {/* The rail turns a group heading into a rule, because a word in a
                64px column is noise. Here there is room for the word, which is
                the whole point of the shape: a caption over the card it names. */}
            <p className="mb-1.5 px-4 text-[11px] font-semibold uppercase tracking-wider text-muted">
              {t(group.label)}
            </p>
            <div className={CARD}>{group.items.map(navRow)}</div>
          </div>
        ))}

        <div className={CARD}>{navRow(help)}</div>

        {/* The account block: what a page load would be too much for, and the
            one warning that cannot wait for one. */}
        <div className={CARD}>
          {fortnox && (
            // A plain <a>: /api/fortnox/connect redirects out to Fortnox's own
            // consent screen, and routing that through the client router would
            // ask Next to render a page that is never going to arrive.
            <a
              href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(pathname)}`}
              onClick={onClose}
              className={cn(ROW, "active:bg-surface")}
            >
              <IconFortnox className="size-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {fortnox.session ? t("fortnoxSignedIn") : t("fortnoxSignIn")}
              </span>
              {/* Warning rather than grey when signed out: the session is short
                  by design, and an export fails until somebody presses this. */}
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  fortnox.session ? "bg-success" : "bg-warning",
                )}
              />
            </a>
          )}
          <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{tc("theme")}</span>
            <ThemeToggle initial={theme} />
          </div>
          <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm font-medium">{tc("language")}</span>
            <LanguageSwitcher />
          </div>
        </div>
      </nav>
    </div>
  );
}
