"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { signOut } from "next-auth/react";
import { useRole } from "./role-context";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { FortnoxMark, IconFortnox } from "./fortnox-mark";
import { ReceiptPanelColumn, useReceiptTabShowing } from "../receipt/receipt-panel";
import {
  IconBank,
  IconIncome,
  IconBook,
  IconBudget,
  IconCard,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconGear,
  IconGrid,
  IconHelp,
  IconHierarchy,
  IconMenu,
  IconReceipt,
  IconUser,
  IconUsers,
} from "../ui/icons";
import {
  canAccessBookkeeping,
  canAccessBudget,
  canAccessSettings,
  hasAttestRole,
} from "@/lib/domain/permissions";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";

import { useFormat } from "@/lib/ui/use-format";
import { cn } from "@/lib/ui/utils";

// Nav visibility is a capability predicate over the current user — their roles
// for most items, plus non-role capabilities like card holdership.
//
// `label` is a key under the `nav` namespace, not text: the table is built once
// at module scope, where there is no locale yet, so the wording is resolved at
// render time instead.
type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  visible: (user: CurrentUser) => boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const ALL = () => true;

// Collapsed-sidebar preference. Kept in a cookie rather than localStorage so the
// server layout can read it and render the right width on the first paint —
// with localStorage the sidebar would flash open on every full page load.
export const SIDEBAR_COOKIE = "sidebar_collapsed";

// How wide the main column may grow. Collapsing the sidebar hands 192px back
// (w-64 → w-16), so the caps grow by the same amount — otherwise collapsing on
// a large monitor would just add side margin instead of room for content.
const CONTENT_MAX = {
  budget: { expanded: "max-w-[1600px]", collapsed: "max-w-[1792px]" },
  default: { expanded: "max-w-7xl", collapsed: "max-w-[1472px]" },
};

// Where settings lands, and the prefix that switches the sidebar over to the
// settings nav.
const SETTINGS_ROOT = "/admin";
const SETTINGS_HOME = "/admin/fortnox";

// Standalone top-level link (no group heading).
const OVERVIEW: NavItem = { href: "/dashboard", label: "overview", icon: IconGrid, visible: ALL };

// Pinned to the foot of the nav rather than sorted into a group, and present in
// the settings nav too: it isn't somewhere you go to do a job, it's what you
// open when a purchase is in front of you and you're not sure of the rules.
const HELP: NavItem = { href: "/faq", label: "faq", icon: IconHelp, visible: ALL };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "groupExpenses",
    items: [
      { href: "/expenses", label: "expenses", icon: IconReceipt, visible: ALL },
      // Only meaningful to someone who actually holds a guild card.
      { href: "/card-purchases", label: "cardPurchases", icon: IconCard, visible: (u) => u.holdsCard },
      { href: "/approvals", label: "approvals", icon: IconCheck, visible: (u) => hasAttestRole(u.roles) },
    ],
  },
  {
    label: "groupBudget",
    items: [
      { href: "/budget", label: "budget", icon: IconBudget, visible: canAccessBudget },
      {
        href: "/ledger",
        label: "outcome",
        icon: IconChart,
        visible: ALL,
      },
    ],
  },
  {
    label: "groupBookkeeping",
    items: [
      {
        href: "/bookkeeping",
        label: "bookkeeping",
        icon: IconBook,
        visible: (u) => canAccessBookkeeping(u.roles),
      },
      {
        href: "/bank",
        label: "bank",
        icon: IconBank,
        visible: (u) => canAccessBookkeeping(u.roles),
      },
      {
        href: "/income",
        label: "income",
        icon: IconIncome,
        visible: (u) => canAccessBookkeeping(u.roles),
      },
    ],
  },
  {
    label: "groupAdmin",
    items: [
      { href: SETTINGS_HOME, label: "settings", icon: IconGear, visible: (u) => canAccessSettings(u.roles) },
    ],
  },
];

// Settings replace the app nav rather than nesting inside it. A settings
// section may need its own list-and-detail layout, and with the app nav still
// in place that would be a third column — so while the path is under /admin the
// sidebar shows these instead, with a way back at the top.
const SETTINGS_NAV: NavGroup[] = [
  {
    label: "settings",
    items: [
      { href: "/admin/fortnox", label: "fortnox", icon: IconFortnox, visible: ALL },
      { href: "/admin/cost-centers", label: "costCenters", icon: IconChart, visible: ALL },
      { href: "/admin/income", label: "income", icon: IconIncome, visible: ALL },
      { href: "/admin/result-units", label: "resultUnits", icon: IconHierarchy, visible: ALL },
      { href: "/admin/cards", label: "cards", icon: IconCard, visible: ALL },
      { href: "/admin/users", label: "users", icon: IconUsers, visible: ALL },
    ],
  },
];

/**
 * Every section of the app by route, with the name the nav gives it.
 *
 * Exported for the back link. A nested page names one parent, but you can reach
 * it from any list that links to it — an utlägg is opened from Utlägg, from
 * Attest, from Bokföring and from Översikt — and "← Utlägg" is the wrong answer
 * on three of those. Derived from the nav itself so a section cannot be added
 * in one place and forgotten in the other. See components/back-link.tsx.
 */
export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  [
    OVERVIEW,
    HELP,
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...SETTINGS_NAV.flatMap((g) => g.items),
  ].map((item) => [item.href, item.label]),
);

export function AppShell({
  children,
  defaultCollapsed = false,
  fortnox,
}: {
  children: React.ReactNode;
  /** Server-read cookie value, so the first paint already has the right width. */
  defaultCollapsed?: boolean;
  /** Present only for users who book in Fortnox under their own login; absent
   *  means the profile menu shows nothing about Fortnox at all. */
  fortnox?: { session: FortnoxStatus["session"] | null };
}) {
  const pathname = usePathname();
  const { user } = useRole();
  const t = useTranslations("nav");
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  // Below md the sidebar is an off-canvas drawer instead of a rail — a 64px
  // rail plus a page is still too much on a phone.
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    // The drawer is only ever open at widths where the document scrolls, so
    // without this the page slides around behind it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [drawerOpen]);

  // Following a link is the natural "done with the menu" signal on mobile, so
  // every navigable thing inside the drawer closes it on the way out.
  const closeDrawer = () => setDrawerOpen(false);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  // Three sidebar states, not two. Inside the mobile drawer it is always the
  // full column. From md to lg it is always the rail: at those widths a 256px
  // column leaves the page under 500px, which is not enough for a DataTable —
  // its trailing columns fell off the screen entirely, and 768 (iPad portrait)
  // came out worse than 767. From lg up `collapsed` decides.
  //
  // So a rail style is written as a plain `md:` variant, which covers both
  // bands, and the expanded state undoes it again at `lg:` — which is what this
  // helper emits.
  const unrail = (classes: string) => (collapsed ? undefined : classes);

  const isActive = (href: string) =>
    pathname === href ||
    (href !== "/expenses/new" && href !== "/dashboard" && pathname.startsWith(href));

  const navLink = (item: NavItem) => {
    const Icon = item.icon;
    const label = t(item.label);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeDrawer}
        // Unconditional, not just when collapsed: the label is display:none
        // for the whole md–lg band now, and without this the link would have
        // no accessible name there at all.
        title={label}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
          "md:justify-center md:gap-0 md:px-0",
          unrail("lg:justify-start lg:gap-3 lg:px-3"),
          isActive(item.href)
            ? "brand-fill text-on-brand"
            : "text-foreground hover:bg-surface",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className={cn("truncate md:hidden", unrail("lg:block"))}>{label}</span>
      </Link>
    );
  };

  // Under /admin the sidebar belongs to settings — see SETTINGS_NAV.
  const inSettings = pathname.startsWith(SETTINGS_ROOT);

  const groups = (inSettings ? SETTINGS_NAV : NAV_GROUPS)
    .map((group) => ({
      ...group,
      items: group.items.filter((i) => i.visible(user)),
    }))
    .filter((group) => group.items.length > 0);

  const caps = pathname.startsWith("/budget") ? CONTENT_MAX.budget : CONTENT_MAX.default;
  const receiptTab = useReceiptTabShowing();

  return (
    // From md up this is a fixed-height app shell: the frame never moves and the
    // main column is the only thing that scrolls. On a phone that costs more
    // than it gives — a browser only retracts its address bar and toolbar in
    // response to the *document* scrolling, so a nested scroller means they stay
    // put and eat ~130px of an already small screen for the whole session. Below
    // md the document scrolls normally instead. dvh, not vh: on iOS `100vh` is
    // the toolbars-hidden height, so `h-screen` here would run the layout past
    // the bottom of what you can actually see.
    // On paper none of that applies: the chrome is dropped and the page column
    // is left to flow, or the printer gets one screenful and nothing after it.
    <div className="flex min-h-dvh md:h-screen md:overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* The first thing the keyboard reaches, and invisible until it does.
          Without it every page begins with a walk through the whole sidebar —
          a dozen-odd links — before the content the reader came for. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-brand-edge focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-[var(--shadow-card)] focus:brand-fill focus:text-on-brand"
      >
        {t("skipToContent")}
      </a>

      {/* Backdrop for the mobile drawer. */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t("closeMenu")}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 cursor-default bg-black/40 md:hidden"
        />
      )}

      {/* Sidebar — off-canvas drawer below md, the rail from md, and a full
          column from lg unless it has been collapsed. */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-background",
          "transition-[width,transform] duration-200 ease-out",
          "md:relative md:z-30 md:h-screen md:shrink-0 md:w-16 md:translate-x-0",
          "print:hidden",
          drawerOpen ? "translate-x-0" : "-translate-x-full",
          unrail("lg:w-64"),
        )}
      >
        {/* Collapse toggle — floats over the right border so it never competes
            with the header for space, and sits inside the main column's own
            padding so it can't overlap page content. Only from lg: below that
            the rail is not a preference, it is the only thing that fits. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t("expandMenu") : t("collapseMenu")}
          title={collapsed ? t("expandMenu") : t("collapseMenu")}
          className="absolute -right-3 top-5 z-10 hidden size-6 items-center justify-center rounded-full border border-border bg-background text-muted shadow-sm transition-colors hover:text-foreground lg:flex"
        >
          {collapsed ? (
            <IconChevronRight className="size-3.5" />
          ) : (
            <IconChevronLeft className="size-3.5" />
          )}
        </button>

        {inSettings ? (
          <Link
            href="/dashboard"
            onClick={closeDrawer}
            title={t("backToApp")}
            className={cn(
              "flex h-16 items-center gap-2 px-6 text-sm font-medium text-muted transition-colors hover:text-foreground",
              "md:justify-center md:px-0",
              unrail("lg:justify-start lg:px-6"),
            )}
          >
            <IconChevronDown className="size-4 shrink-0 rotate-90" />
            <span className={cn("md:hidden", unrail("lg:inline"))}>{t("backToApp")}</span>
          </Link>
        ) : (
          <div
            className={cn(
              "flex h-16 items-center gap-2.5 px-6",
              "md:justify-center md:px-0",
              unrail("lg:justify-start lg:px-6"),
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-10 shrink-0" />
            <div className={cn("leading-tight md:hidden", unrail("lg:block"))}>
              <p className="text-sm font-semibold">D-sektionen</p>
              <p className="text-xs text-muted">{t("brandTagline")}</p>
            </div>
          </div>
        )}

        <nav aria-label={t("mainNav")} className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-2">
          {!inSettings && <div className="flex flex-col gap-0.5">{navLink(OVERVIEW)}</div>}
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              {/* On the rail, the gap between groups carries the grouping. */}
              <p
                className={cn(
                  "px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted md:hidden",
                  unrail("lg:block"),
                )}
              >
                {t(group.label)}
              </p>
              {group.items.map(navLink)}
            </div>
          ))}
          {/* `mt-auto` so it sits against the profile footer however few groups
              this user's roles leave above it. */}
          <div className="mt-auto flex flex-col gap-0.5 pt-4">{navLink(HELP)}</div>
        </nav>

        {/* Sticky profile footer */}
        <ProfileFooter
          user={user}
          collapsed={collapsed}
          onNavigate={closeDrawer}
          fortnox={fortnox}
        />
      </aside>

      {/* Main column — the only scroll container from md up; below that the
          document itself scrolls, so the browser chrome can get out of the way. */}
      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto print:overflow-visible">
        {/* Mobile top bar: the only way to reach the nav below md. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden print:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label={t("openMenu")}
            className="-ml-1 flex size-9 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-surface"
          >
            <IconMenu className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/symbol_rosa.svg" alt="" className="h-7" />
          <p className="text-sm font-semibold">D-sektionen</p>
        </header>

        <main
          id="main"
          // Focusable only as the skip link's destination: without it the jump
          // moves the viewport and leaves focus where it was, so the next Tab
          // goes back into the nav the reader just skipped.
          tabIndex={-1}
          className={cn(
            // Asymmetric on purpose. The top needs less than it had (a page
            // header already carries its own space, and on a phone the sticky
            // bar sits right above it); the bottom needs much more, so the last
            // block clears the end of the scroll instead of butting against it.
            // The phone gutter drops to 16px: at 20px, page padding plus card
            // inset spent 36px of a 375px screen before any content.
            "mx-auto w-full flex-1 pb-16 pl-4 pt-6 md:pb-20 md:pl-8 md:pt-8",
            // The folded receipt tab is `fixed`, so it reserves no width and
            // would otherwise sit on top of whatever reaches the right edge.
            // Written as one side or the other, never both: `cn` joins rather
            // than merges, so two `pr-` utilities would be settled by
            // stylesheet order instead of by intent.
            receiptTab ? "pr-14 md:pr-16" : "pr-4 md:pr-8",
            // The budget sheets need more room; everything else stays centered.
            collapsed ? caps.collapsed : caps.expanded,
          )}
        >
          {children}
        </main>
      </div>

      {/* The receipt, when the open page has one. A sibling of the main column
          rather than something inside it: that's what lets it stand the full
          height of the frame and stay put while the page scrolls. */}
      <ReceiptPanelColumn />
    </div>
  );
}

// Whether this user's own Fortnox login is live — the identity their exported
// vouchers get stamped with. Distinct from the section's service connection,
// which is admin-managed and lives under Settings → Fortnox.
function FortnoxAccountButton({
  session,
  returnTo,
}: {
  session: FortnoxStatus["session"] | null;
  returnTo: string;
}) {
  const t = useTranslations("nav.fortnoxAccount");
  const { dateTime } = useFormat();
  const connected = Boolean(session);
  return (
    <a
      href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(returnTo)}`}
      className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-surface"
    >
      <FortnoxMark />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-xs font-medium">
          {connected ? session?.fortnoxUserName || t("connected") : "Fortnox"}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {connected
            ? t("signedInUntil", { time: dateTime(session!.expiresAt) })
            : t("signedOut")}
        </span>
      </span>
      <span
        aria-hidden
        className={cn(
          "size-2 shrink-0 rounded-full",
          connected ? "bg-success" : "bg-muted/50",
        )}
      />
    </a>
  );
}

// Bottom-of-sidebar profile: a trigger showing the user, and a popover panel
// (opening upward) with the quick switches — theme, language, Fortnox status,
// sign-out. Everything here also lives on /profile, which is where the details
// (payout account, full Fortnox controls) are edited; the corner icon is the
// way there.
function ProfileFooter({
  user,
  collapsed,
  onNavigate,
  fortnox,
}: {
  user: CurrentUser;
  collapsed: boolean;
  onNavigate: () => void;
  fortnox?: { session: FortnoxStatus["session"] | null };
}) {
  const { name, email, initials, roles } = user;
  const t = useTranslations("common");
  const tRole = useTranslations("common.role");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Same md-always / lg-undo pairing as the sidebar above — see AppShell.
  const unrail = (classes: string) => (collapsed ? undefined : classes);

  return (
    <div className="relative border-t border-border p-3">
      {open && (
        // Click-catcher to dismiss the popover.
        <button
          type="button"
          aria-label={t("close")}
          className="fixed inset-0 z-10 cursor-default"
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        // Collapsed, the rail is far too narrow to hold this — the panel keeps
        // its full width and spills to the right over the page instead.
        <div
          className={cn(
            "absolute bottom-full left-3 right-3 z-20 mb-2 rounded-xl border border-border bg-background p-3 shadow-lg",
            "md:right-auto md:w-64",
            unrail("lg:right-3 lg:w-auto"),
          )}
        >
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{name}</p>
                <p className="truncate text-xs text-muted">{email}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {roles.length ? roles.map((r) => tRole(r)).join(" · ") : tRole("ORDINARIE")}
                </p>
              </div>
              {/* The way to the full profile. Sits in the corner so it reads as
                  "open this" rather than as one more setting in the list. */}
              <Link
                href="/profile"
                onClick={() => {
                  setOpen(false);
                  onNavigate();
                }}
                title={tNav("profile")}
                aria-label={tNav("profile")}
                className="-mr-1 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground"
              >
                <IconUser className="size-[18px]" />
              </Link>
            </div>

            {fortnox && (
              <FortnoxAccountButton session={fortnox.session} returnTo={pathname} />
            )}

            <div className="flex items-center justify-between border-t border-border pt-2.5">
              <span className="text-xs text-muted">{t("theme")}</span>
              <ThemeToggle />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted">{t("language")}</span>
              <LanguageSwitcher />
            </div>

            <Button
              variant="dangerOutline"
              size="sm"
              className="w-full"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              {t("signOut")}
            </Button>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={name}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface",
          "md:justify-center md:gap-0 md:px-0",
          unrail("lg:justify-start lg:gap-3 lg:px-2"),
        )}
      >
        <Avatar initials={initials} />
        <div className={cn("min-w-0 flex-1 leading-tight md:hidden", unrail("lg:block"))}>
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <IconChevronDown
          className={cn(
            "size-4 shrink-0 text-muted transition-transform md:hidden",
            open && "rotate-180",
            unrail("lg:block"),
          )}
        />
      </button>
    </div>
  );
}
