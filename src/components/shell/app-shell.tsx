"use client";

import { useEffect, useRef, useState } from "react";
import { useEscape } from "@/lib/ui/escape";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRole } from "./role-context";
import { ReceiptPanelColumn, useReceiptTabShowing } from "../receipt/receipt-panel";
import { MobileNav } from "./mobile-nav";
import { NavCount } from "./nav-count";
import { SectionBand, SectionNavProvider, type SectionNav } from "./section-nav";
import { AppHeader, FiscalYearPicker, MenuButton, type FiscalYears } from "./app-header";
import { FiscalYearProvider } from "./fiscal-year-context";
import { useGuides } from "./guide";
import {
  IconBox,
  IconPlus,
  IconCalendar,
  IconIncome,
  IconInvoice,
  IconBook,
  IconBudget,
  IconCard,
  IconChart,
  IconGear,
  IconGrid,
  IconHelp,
  IconLedger,
  IconList,
  IconMail,
  IconReceipt,
  IconPerson,
  IconUsers,
} from "../ui/icons";
import {
  canSeeInvoices,
  canViewBookkeeping,
  canAccessBudget,
  canSeeUsers,
  canTriageInvoices,
  canViewStock,
  hasBoardTab,
  canBookkeep,
  canBookStock,
  canMoveStock,
  canViewMemberScores,
  isAdmin,
} from "@/lib/domain/permissions";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import { SETTINGS_ROOT, SETTINGS_SECTIONS } from "./settings-sections";

import { carriedSection, owningRoute } from "@/lib/ui/routes";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { cn } from "@/lib/ui/utils";
import { useLiveNavCounts } from "./nav-counts";

export type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  visible: (user: CurrentUser) => boolean;
};

export type NavGroup = {
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  items: NavItem[];
};

const ALL = () => true;

const SETTINGS_HOME = SETTINGS_ROOT;

const OVERVIEW: NavItem = { href: "/dashboard", label: "overview", icon: IconGrid, visible: ALL };

const HELP: NavItem = { href: "/faq", label: "faq", icon: IconHelp, visible: ALL };

const SETTINGS: NavItem = {
  href: SETTINGS_HOME,
  label: "settings",
  icon: IconGear,
  visible: (u) => canSeeUsers(u.capabilities),
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "groupExpenses",
    icon: IconReceipt,
    items: [
      { href: "/expenses", label: "expenses", icon: IconReceipt, visible: ALL },
      {
        href: "/bank",
        label: "bank",
        icon: IconCard,
        visible: (u) =>
          u.holdsCard || u.roles.includes("RESULTATANSVARIG") || canViewBookkeeping(u.capabilities),
      },
    ],
  },
  {
    label: "groupInvoices",
    icon: IconInvoice,
    items: [
      {
        href: "/invoices/inbox",
        label: "invoiceInbox",
        icon: IconMail,
        visible: (u) => canTriageInvoices(u.capabilities) || isAdmin(u.capabilities),
      },
      {
        href: "/invoices",
        label: "invoices",
        icon: IconInvoice,
        visible: (u) => canSeeInvoices(u.capabilities),
      },
    ],
  },
  {
    label: "groupIncome",
    icon: IconIncome,
    items: [
      {
        href: "/income/zettle",
        label: "incomeZettle",
        icon: IconCard,
        visible: (u) => canViewBookkeeping(u.capabilities),
      },
      {
        href: "/income/swish",
        label: "incomeSwish",
        icon: IconIncome,
        visible: (u) => canViewBookkeeping(u.capabilities),
      },
    ],
  },
  {
    label: "groupBookkeeping",
    icon: IconBook,
    items: [
      {
        href: "/closing",
        label: "closing",
        icon: IconLedger,
        visible: (u) => canViewBookkeeping(u.capabilities),
      },
    ],
  },
  {
    label: "groupBudget",
    icon: IconBudget,
    items: [
      {
        href: "/budget",
        label: "budget",
        icon: IconBudget,
        visible: (u) => canAccessBudget(u.capabilities),
      },
      {
        href: "/ledger",
        label: "outcome",
        icon: IconChart,
        visible: ALL,
      },
    ],
  },
  {
    label: "groupStock",
    icon: IconBox,
    items: [
      {
        href: "/stock/alcohol",
        label: "stock",
        icon: IconBox,
        visible: (u) => canViewStock(u.capabilities, "alcohol"),
      },
      {
        href: "/stock/alcohol/events",
        label: "stockEvents",
        icon: IconCalendar,
        visible: (u) => canViewStock(u.capabilities, "alcohol"),
      },
      // The stock's vouchers to Fortnox, for bookkeepers (docs/stock.md).
      {
        href: "/stock/alcohol/bookkeeping",
        label: "stockBookkeeping",
        icon: IconLedger,
        visible: (u) => canBookStock(u.capabilities),
      },
      {
        href: "/stock/alcohol/history",
        label: "stockHistory",
        icon: IconList,
        visible: (u) => canViewStock(u.capabilities, "alcohol"),
      },
    ],
  },
  // The café's stock: its own group, because its people and its pages are not the bar's (docs/stock.md).
  {
    label: "groupCafeStock",
    icon: IconBox,
    items: [
      // Products first, so the group opens on the stock itself.
      {
        href: "/stock/cafe",
        label: "cafeStock",
        icon: IconBox,
        visible: (u) => canViewStock(u.capabilities, "cafe"),
      },
      {
        href: "/stock/cafe/move",
        label: "cafeMove",
        icon: IconPlus,
        visible: (u) => canMoveStock(u, "cafe"),
      },
      {
        href: "/stock/cafe/bookkeeping",
        label: "stockBookkeeping",
        icon: IconLedger,
        visible: (u) => canBookStock(u.capabilities),
      },
      {
        href: "/stock/cafe/history",
        label: "cafeStockHistory",
        icon: IconList,
        visible: (u) => canViewStock(u.capabilities, "cafe"),
      },
    ],
  },
  // Styrelseborder: the board's tab in the café stock. Logging, a member's own, and the treasury's invoicing, each its
  // own page. A member who has left still reaches /board/history by its address while it holds rows.
  {
    label: "groupBoard",
    icon: IconReceipt,
    items: [
      {
        href: "/board",
        label: "boardLog",
        icon: IconPlus,
        visible: (u) => hasBoardTab(u.capabilities) || canBookkeep(u.capabilities),
      },
      {
        href: "/board/history",
        label: "boardHistory",
        icon: IconReceipt,
        visible: (u) => hasBoardTab(u.capabilities),
      },
      {
        href: "/board/invoices",
        label: "boardInvoices",
        icon: IconInvoice,
        visible: (u) => canViewBookkeeping(u.capabilities),
      },
      {
        href: "/board/prices",
        label: "boardPrices",
        icon: IconList,
        visible: (u) => hasBoardTab(u.capabilities) || canViewBookkeeping(u.capabilities),
      },
    ],
  },
];

const PROFILE_GROUP: NavGroup = {
  label: "profile",
  icon: IconPerson,
  items: [
    { href: "/profile", label: "profile", icon: IconPerson, visible: ALL },
    {
      href: "/profile/members",
      label: "members",
      icon: IconUsers,
      visible: (u) => canViewMemberScores(u.capabilities),
    },
  ],
};

const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  [
    OVERVIEW,
    HELP,
    SETTINGS,
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...PROFILE_GROUP.items,
    ...SETTINGS_SECTIONS,
  ].map((item) => [item.href, item.label]),
);

const sectionHref = (path: string): string | null => owningRoute(path, Object.keys(SECTION_LABELS));

export function AppShell({
  children,
  fortnox,
  counts: seededCounts = {},
  fiscal = null,
}: {
  children: React.ReactNode;
  fortnox?: { session: FortnoxStatus["session"] | null; company: string | null };
  counts?: Record<string, number>;
  fiscal?: FiscalYears | null;
}) {
  const pathname = usePathname();
  const { user } = useRole();
  const counts = useLiveNavCounts(seededCounts);
  const t = useTranslations("nav");
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  const [menuOpen, setMenuOpen] = useState(false);

  const [sectionSlot, setSectionSlot] = useState<HTMLElement | null>(null);
  const [pageOwn, setPageOwn] = useState<boolean | null>(null);

  useEscape(menuOpen, () => setMenuOpen(false));
  useEscape(navOpen && !menuOpen, () => setNavOpen(false));
  useDismissOnOutside(navOpen, [navRef, navToggleRef], () => setNavOpen(false));

  const { hold } = useGuides();
  const navShown = navOpen || hold === "nav";
  const menuShown = menuOpen || hold === "phone-menu";

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  const closeNav = () => {
    setMenuOpen(false);
    setNavOpen(false);
  };

  const [lit, setLit] = useState<{ path: string; section: string | null }>(() => ({
    path: pathname,
    section: sectionHref(pathname),
  }));
  let activeSection = lit.section;
  if (lit.path !== pathname) {
    activeSection = carriedSection(pathname, lit.section, Object.keys(SECTION_LABELS));
    setLit({ path: pathname, section: activeSection });
  }
  const isActive = (href: string) => href === activeSection;

  const navLink = (item: NavItem) =>
    navRow({
      href: item.href,
      label: t(item.label),
      icon: item.icon,
      active: isActive(item.href),
      count: counts[item.href] ?? 0,
      tour: item === SETTINGS ? "nav-settings" : undefined,
    });

  const navRow = ({
    href,
    label,
    icon: Icon,
    active,
    count,
    tour,
  }: {
    href: string;
    label: string;
    icon: NavItem["icon"];
    active: boolean;
    count: number;
    tour?: string;
  }) => {
    return (
      <Link
        key={href}
        href={href}
        onClick={closeNav}
        data-tour={tour}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2.5 rounded-control px-2 text-sm transition-colors",
          active
            ? "bg-action-from/15 font-medium text-foreground"
            : "text-foreground hover:bg-hover",
        )}
      >
        <Icon className={cn("size-[18px] shrink-0", active && "text-action-from")} />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 && <NavCount count={count} />}
      </Link>
    );
  };

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => i.visible(user)),
  })).filter((group) => group.items.length > 0);

  const profileGroup = {
    ...PROFILE_GROUP,
    items: PROFILE_GROUP.items.filter((i) => i.visible(user)),
  };
  const tabSection =
    [...groups, profileGroup].find(
      (g) => g.items.length > 1 && g.items.some((i) => isActive(i.href)),
    ) ?? null;
  const sectionNav: SectionNav | null = tabSection && {
    label: t(tabSection.label),
    tabsLabel: t("sectionTabs"),
    tabs: tabSection.items.map((i) => ({
      href: i.href,
      label: t(i.label),
      icon: i.icon,
      active: isActive(i.href),
      count: counts[i.href] ?? 0,
    })),
    root: tabSection.items.some((i) => i.href === pathname),
  };

  const sectionKey = activeSection === null ? null : SECTION_LABELS[activeSection];
  const section = sectionKey ? t(sectionKey) : null;

  const receiptTab = useReceiptTabShowing();

  return (
    // Clip, not hidden: a hidden box can still be scrolled from script. Next scrolls a new page into view with
    // scrollIntoView, which moved this frame too, leaving the page and the receipt panel shifted up with no way back.
    <div className="flex min-h-dvh flex-col md:h-screen md:overflow-clip print:block print:h-auto print:overflow-visible">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-[var(--shadow-card)] focus:bg-action-from focus:text-on-action"
      >
        {t("skipToContent")}
      </a>

      <MobileNav
        open={menuShown}
        onClose={closeNav}
        overview={OVERVIEW}
        groups={groups}
        settings={SETTINGS.visible(user) ? SETTINGS : null}
        isActive={isActive}
        counts={counts}
        user={user}
        fortnox={fortnox}
      />

      <AppHeader
        user={user}
        fortnox={fortnox}
        fiscal={fiscal}
        navOpen={navShown}
        navToggleRef={navToggleRef}
        onToggleNav={() => setNavOpen(!navOpen)}
        waiting={Object.values(counts).some((n) => n > 0)}
      />

      <div className="relative flex min-h-0 flex-1 print:block">
        <div
          id="app-nav"
          ref={navRef}
          inert={!navShown}
          className={cn(
            "absolute inset-y-0 left-0 z-30 hidden w-64 print:hidden md:block",
            "transition-[translate,visibility] duration-250 ease-out",
            navShown ? "translate-x-0" : "invisible -translate-x-full",
          )}
        >
          <aside className="flex h-full w-64 flex-col border-r border-border bg-background shadow-xl">
            <nav
              aria-label={t("mainNav")}
              className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">{navLink(OVERVIEW)}</div>
              <div className="flex flex-col gap-0.5">
                {groups.map((group) =>
                  navRow({
                    href: group.items[0].href,
                    label: t(group.label),
                    icon: group.icon,
                    active: group.items.some((i) => isActive(i.href)),
                    count: group.items.reduce((n, i) => n + (counts[i.href] ?? 0), 0),
                    tour: `nav-group:${group.label}`,
                  }),
                )}
              </div>
              {SETTINGS.visible(user) && (
                <div className="mt-auto flex flex-col gap-0.5 pt-4">{navLink(SETTINGS)}</div>
              )}
            </nav>
          </aside>
        </div>

        <div
          data-main-scroll
          className="relative flex min-w-0 flex-1 flex-col md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain print:overflow-visible"
        >
          <header
            data-guide-edge="top"
            className="sticky top-0 z-20 flex h-app-bar shrink-0 items-center gap-3 border-b border-border bg-background px-4 pt-[env(safe-area-inset-top)] md:hidden print:hidden"
          >
            {/* The one way to move between sections on a phone, on every page: no bottom bar that comes and goes. */}
            <MenuButton
              open={menuShown}
              onClick={() => setMenuOpen(true)}
              waiting={Object.values(counts).some((n) => n > 0)}
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-6" />
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">
              {section ?? "D-sektionen"}
            </p>
            {fiscal && <FiscalYearPicker fiscal={fiscal} />}
          </header>

          <main
            id="main"
            tabIndex={-1}
            className={cn(
              "receipt-main w-full flex-1 pl-4 pt-6 md:pl-6",
              // Nothing floats over the foot of a phone's page any more: room for the home indicator and a breath.
              "pb-[calc(env(safe-area-inset-bottom)+2rem)] md:pb-20",
              receiptTab ? "[--main-pr:1.5rem] md:[--main-pr:3rem]" : "[--main-pr:1.5rem]",
              "pr-(--main-pr)",
              // `--sticky-top`: how much is pinned over the page, for a page's own sticky parts
              // (a table head). The phone's app bar, and the section band (h-11 and its border)
              // where the section has tabs. The app bar is gone from md.
              sectionNav
                ? "[--sticky-top:calc(3rem+1px+env(safe-area-inset-top)+2.75rem+1px)] md:[--sticky-top:calc(2.75rem+1px)]"
                : "[--sticky-top:calc(3rem+1px+env(safe-area-inset-top))] md:[--sticky-top:0px]",
            )}
          >
            <SectionNavProvider
              value={{
                nav: sectionNav,
                slot: sectionSlot,
                reportOwn: setPageOwn,
              }}
            >
              {sectionNav && (
                <SectionBand
                  section={sectionNav}
                  own={pageOwn ?? sectionNav.root}
                  slotRef={setSectionSlot}
                />
              )}
              <FiscalYearProvider value={fiscal?.selected ?? null}>{children}</FiscalYearProvider>
            </SectionNavProvider>
          </main>
        </div>

        <ReceiptPanelColumn />
      </div>
    </div>
  );
}
