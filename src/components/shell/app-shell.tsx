"use client";

import { useEffect, useRef, useState } from "react";
import { useEscape } from "@/lib/ui/escape";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRole } from "./role-context";
import {
  ReceiptPanelColumn,
  useReceiptPanelActive,
  useReceiptTabShowing,
} from "../receipt/receipt-panel";
import { TabBar } from "./tab-bar";
import { MobileNav } from "./mobile-nav";
import { NavCount } from "./nav-count";
import { SectionBand, SectionNavProvider, type SectionNav } from "./section-nav";
import { AppHeader, FiscalYearPicker, type FiscalYears } from "./app-header";
import { FiscalYearProvider } from "./fiscal-year-context";
import {
  IconArchive,
  IconBox,
  IconCalendar,
  IconIncome,
  IconInvoice,
  IconBook,
  IconBudget,
  IconCard,
  IconChart,
  IconContract,
  IconGear,
  IconGrid,
  IconHelp,
  IconKey,
  IconLedger,
  IconList,
  IconMail,
  IconMenu,
  IconReceipt,
  IconUsers,
} from "../ui/icons";
import {
  canSeeInvoices,
  canViewBookkeeping,
  canAccessBudget,
  canAccessSettings,
  canManageRentals,
  canTriageInvoices,
  canViewContracts,
  canViewRentals,
  canViewStock,
  isAdmin,
} from "@/lib/domain/permissions";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import { SETTINGS_ROOT, SETTINGS_SECTIONS } from "./settings-sections";

import { carriedSection, owningRoute, routePath } from "@/lib/ui/routes";
import { useTypingFlag } from "@/lib/ui/typing";
import { useDismissOnOutside } from "@/lib/ui/dismiss";
import { cn } from "@/lib/ui/utils";

// Nav visibility is a capability predicate over the current user: their roles
// for most items, plus non-role capabilities like card holdership.
//
// `label` is a key under the `nav` namespace, not text: the table is built once
// at module scope, where there is no locale yet, so the wording is resolved at
// render time instead.
export type NavItem = {
  href: string;
  label: string;
  icon: (p: { className?: string }) => React.ReactNode;
  visible: (user: CurrentUser) => boolean;
};

/**
 * A section of the app: one row in the nav, and its pages as tabs across the
 * top of each of them (see SectionTabs). The row goes to the first page the
 * reader may see.
 */
export type NavGroup = {
  label: string;
  /** The section's row in the nav. */
  icon: (p: { className?: string }) => React.ReactNode;
  items: NavItem[];
};

const ALL = () => true;

// How wide the main column may grow. One cap per section, not two: the nav
// lies over the page rather than beside it, so it never costs the row width.
const CONTENT_MAX = {
  budget: "max-w-[1792px]",
  default: "max-w-[1472px]",
};

// The landing page, not the first section. It used to point straight at
// /admin/fortnox, on the reasoning that the sidebar lists the sections so there
// was nothing for an index to add. True at this width and false on a phone,
// where there is no sidebar: you were dropped on Fortnox, whatever you came
// for, and had to open the menu a second time to get anywhere. See
// (app)/admin/page.tsx.
const SETTINGS_HOME = SETTINGS_ROOT;

// Standalone top-level link (no group heading).
const OVERVIEW: NavItem = { href: "/dashboard", label: "overview", icon: IconGrid, visible: ALL };

// Pinned to the foot of the nav rather than sorted into a group, and present in
// the settings nav too: it isn't somewhere you go to do a job, it's what you
// open when a purchase is in front of you and you're not sure of the rules.
const HELP: NavItem = { href: "/faq", label: "faq", icon: IconHelp, visible: ALL };

// Pinned beside it for the same reason: it used to sit inside groupAdmin,
// under "Dokument" and "Motparter", two records the section keeps rather than
// app configuration, which buried the one link that opens a whole overlay
// under a group about neither. It isn't a job either, so it gets Help's
// treatment instead of a group's.
const SETTINGS: NavItem = {
  href: SETTINGS_HOME,
  label: "settings",
  icon: IconGear,
  visible: (u) => canAccessSettings(u.capabilities),
};

const NAV_GROUPS: NavGroup[] = [
  {
    label: "groupExpenses",
    icon: IconReceipt,
    items: [
      { href: "/expenses", label: "expenses", icon: IconReceipt, visible: ALL },
      // The bank feed, which used to be two links: "Kortköp" here for a card
      // holder and "Bank & matchning" under Bokföring for the treasury. One
      // page reads both ways now (see (app)/bank/page.tsx), so it is one link,
      // and it belongs here rather than under Bokföring, because for most of
      // the people who open it the errand is turning a purchase into an utlägg.
      {
        href: "/bank",
        label: "bank",
        icon: IconCard,
        // A resultatansvarig reads their unit's card purchases there too. The
        // role is the closest thing the frame knows to "answers for a unit";
        // the page itself checks the unit (bank/page.tsx).
        visible: (u) =>
          u.holdsCard ||
          u.roles.includes("RESULTATANSVARIG") ||
          canViewBookkeeping(u.capabilities),
      },
      // No Att attestera here any more. It is a stage, and stage is a tab:
      // the utlägg to attest are Utlägg on Min resultatenhet, the levfakturor
      // are Fakturor on the same. What waits on you across both is on
      // Översikt. See docs/navigation.md.
    ],
  },
  {
    label: "groupInvoices",
    icon: IconInvoice,
    items: [
      // Where every levfaktura starts, as a document: given to a unit by
      // triage, and fördelad there, which makes it an invoice. A
      // resultatansvarig reads it narrowed to their units. The role is the
      // closest thing the frame knows to "answers for a unit", as for /bank.
      {
        href: "/invoices/inbox",
        label: "invoiceInbox",
        icon: IconMail,
        visible: (u) =>
          canTriageInvoices(u.capabilities) || isAdmin(u.capabilities) || u.roles.includes("RESULTATANSVARIG"),
      },
      // Every levfaktura from the moment it is given to a unit until it is in
      // Fortnox, the stage as a tab, the way Utlägg is. It used to be split
      // three ways: the Inkorg and the booking half under Bokföring, the
      // attest half on Att attestera. An invoice sitting with its unit was
      // under neither heading.
      {
        href: "/invoices",
        label: "invoices",
        icon: IconInvoice,
        visible: (u) => canSeeInvoices(u.capabilities),
      },
    ],
  },
  {
    label: "groupBookkeeping",
    icon: IconBook,
    items: [
      // No Utlägg row: booking them is the Utlägg list on Alla, where stage is
      // a tab. What is left here has no list of its own anywhere else.
      {
        href: "/income",
        label: "income",
        icon: IconIncome,
        visible: (u) => canViewBookkeeping(u.capabilities),
      },
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
        // Was `visible: canAccessBudget` when that helper took nothing and
        // answered true. The budget is the section's, not the treasury's. It
        // is a capability now, granted to every role by the migration, so the
        // default is unchanged and narrowing it no longer needs a deploy.
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
      // Its own group rather than a line under Bokföring: keeping the
      // lagerbokföring is a different job, done by different people, and the
      // roles that see this see nothing else in the app.
      { href: "/stock", label: "stock", icon: IconBox, visible: (u) => canViewStock(u.capabilities) },
      // Above the log, because it is where the work happens: taking stock out
      // and bringing it back is registered on the event it belongs to. The
      // log is what you open when a figure looks wrong.
      {
        href: "/stock/events",
        label: "stockEvents",
        icon: IconCalendar,
        visible: (u) => canViewStock(u.capabilities),
      },
      // Last in the group, because it is the one you open to look rather than
      // to do: the two above are where the work happens. The log and the
      // statistics, as two views of one page (stock/history/views.ts); they
      // were two tabs answering the same question for the same people.
      {
        href: "/stock/history",
        label: "stockHistory",
        icon: IconList,
        visible: (u) => canViewStock(u.capabilities),
      },
    ],
  },
  {
    label: "groupRental",
    icon: IconKey,
    items: [
      // Its own group rather than a corner of Avtal, for the same reason
      // Alkohollager is not a corner of Bokföring: it is a different job done
      // by different people. The archive answers "which agreements do we have";
      // this answers "where is the gear", and somebody with a store room needs
      // the second question to have a home.
      {
        href: "/rentals",
        label: "rentals",
        icon: IconContract,
        visible: (u) => canViewRentals(u.capabilities),
      },
      // The catalogue lives here rather than in Inställningar, where it started.
      // /stock holds the products and Inställningar → Lager holds only the
      // bookkeeping accounts; a list of the section's own things is not
      // configuration of the app.
      {
        href: "/rentals/equipment",
        label: "rentalItems",
        icon: IconBox,
        visible: (u) => canManageRentals(u.capabilities),
      },
    ],
  },
  {
    label: "groupAdmin",
    icon: IconArchive,
    items: [
      // The archive, over every kind of agreement the section has. Distinct
      // from Uthyrning above, which is the same rows read as a work list. See
      // lib/data/rentals.ts.
      {
        href: "/contracts",
        label: "contracts",
        icon: IconList,
        visible: (u) => canViewContracts(u.capabilities),
      },
      // Next to the archive it feeds rather than under Inställningar, the same
      // choice /rentals/equipment makes for the gear catalogue: a list of
      // who the section has agreed with is not configuration of the app.
      {
        href: "/contracts/counterparties",
        label: "counterparties",
        icon: IconUsers,
        visible: (u) => canManageRentals(u.capabilities),
      },
    ],
  },
];

/**
 * Every section of the app by route, with the name the nav gives it.
 *
 * Exported for the back link. A nested page names one parent, but you can reach
 * it from any list that links to it. An utlägg is opened from Utlägg, from
 * Attest, from Bokföring and from Översikt, and "← Utlägg" is the wrong answer
 * on three of those. Derived from the nav itself so a section cannot be added
 * in one place and forgotten in the other. See components/back-link.tsx.
 *
 * Settings' own sections are included too (from ./settings-sections, the same
 * list the overlay's internal nav and the landing page's cards use), since a
 * page reached through one of them wants the same treatment as any other.
 */
const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  [OVERVIEW, HELP, SETTINGS, ...NAV_GROUPS.flatMap((g) => g.items), ...SETTINGS_SECTIONS].map(
    (item) => [item.href, item.label],
  ),
);

/**
 * Which section of the app a path belongs to, as the nav route that owns it.
 * See lib/ui/routes' `owningRoute`, which is where the rule and its tests live.
 *
 * One rule for two readers. The sidebar lit every row whose route was a prefix
 * of the path, so /stock/events lit Produkter and Tillfällen together, while
 * this same lookup, one screen away, was already answering "Tillfällen" for the
 * phone's top bar. They cannot disagree now.
 */
const sectionHref = (path: string): string | null =>
  owningRoute(path, Object.keys(SECTION_LABELS));

export function AppShell({
  children,
  fortnox,
  counts = {},
  fiscal = null,
}: {
  children: React.ReactNode;
  /**
   * The reader's own Fortnox login, when they are one of the roles that books
   * under one. Absent for everybody else, and the nav shows nothing: the row
   * is an action only the treasury can take. A present-but-null session is
   * signed out. See the foot of the nav.
   */
  fortnox?: { session: FortnoxStatus["session"] | null };
  /** How much waits behind each link, by its href. See lib/data/nav-counts. */
  counts?: Record<string, number>;
  /** Fortnox's financial years and the one in force, for the header's
   *  picker. Null before any year has been synced, and there is no picker. */
  fiscal?: FiscalYears | null;
}) {
  const pathname = usePathname();
  const { user } = useRole();
  const t = useTranslations("nav");
  // Two flags, because there are two navs and they are not the same thing
  // held open at two widths.
  //
  // `navOpen` is the desktop panel's, opened from the header's Meny button. It
  // lies over the page rather than standing beside it, so it is a passing
  // thing: it starts shut, and following a link or pressing outside shuts it.
  const [navOpen, setNavOpen] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);

  // The phone's menu, which always starts shut. It used to share the desktop
  // flag, and that quietly meant a reader who had left the nav open on a laptop
  // arrived on their phone with the menu open over every page.
  const [menuOpen, setMenuOpen] = useState(false);

  // Where a page's switch goes in the section band: the band's own element,
  // once it has one. See PageHeader in section-nav.tsx.
  const [sectionSlot, setSectionSlot] = useState<HTMLElement | null>(null);
  // Whether the open page is one of its section's own, as the page itself
  // says (PageHeader), which knows whether it has a way back. Until it has
  // said, the path is the guess.
  const [pageOwn, setPageOwn] = useState<boolean | null>(null);

  // Escape closes whichever of them is open, and only the topmost layer hears
  // it, since a combobox inside the menu answers first. See lib/ui/escape.ts.
  useEscape(menuOpen, () => setMenuOpen(false));
  useEscape(navOpen && !menuOpen, () => setNavOpen(false));
  // The toggle counts as inside, or a press on it would shut the panel on the
  // way down and its click would open it again.
  useDismissOnOutside(navOpen, [navRef, navToggleRef], () => setNavOpen(false));

  useEffect(() => {
    if (!menuOpen) return;
    // Below md the document is what scrolls and the menu is covering all of it,
    // so without this the page slides about behind an opaque screen.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [menuOpen]);

  // Following a link is the natural "done with the menu" signal, so every
  // navigable thing inside either nav closes it on the way out.
  const closeNav = () => {
    setMenuOpen(false);
    setNavOpen(false);
  };

  // Exactly one row is lit, and it is the section that owns this page rather
  // than every section whose route is a prefix of it. The two exceptions this
  // used to carry are gone with the prefix test that needed them: /dashboard
  // was excluded so it would not swallow everything under it, and
  // "/expenses/new" was never a nav route at all, so that clause could not
  // fire.
  //
  // Which section that is for a page reached from several (an utlägg, opened
  // from Attest or Bokföring) is the one you came from, carried across while
  // you stay on such pages. See carriedSection. Worked out during render when
  // the path changes, so the tabs and the sidebar never show the URL's section
  // for a frame before settling.
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
    });

  // One row of the nav: a section, or one of the pages that stand on their own
  // (Översikt, Inställningar, Frågor & svar).
  const navRow = ({
    href,
    label,
    icon: Icon,
    active,
    count,
  }: {
    href: string;
    label: string;
    icon: NavItem["icon"];
    active: boolean;
    count: number;
  }) => {
    return (
      <Link
        key={href}
        href={href}
        onClick={closeNav}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2.5 rounded-control px-2 text-sm transition-colors",
          active ? "bg-hover font-medium text-foreground" : "text-foreground hover:bg-hover",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count > 0 && <NavCount count={count} active={active} />}
      </Link>
    );
  };

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((i) => i.visible(user)),
  })).filter((group) => group.items.length > 0);

  // The section whose pages go across the top of this one as tabs: the one
  // that owns it, where it has more than one page for this reader. Drawn by
  // the page's own header (components/shell/section-nav.tsx), on the
  // section's pages and on everything under them, an utlägg or a budget, so
  // the way across to the section's other pages is always at the top.
  const tabSection =
    groups.find((g) => g.items.length > 1 && g.items.some((i) => isActive(i.href))) ?? null;
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

  // The same answer the sidebar highlights with, spelled out. The top bar and
  // the lit row cannot disagree if they are the one lookup.
  const sectionKey = activeSection === null ? null : SECTION_LABELS[activeSection];
  const section = sectionKey ? t(sectionKey) : null;

  const caps = pathname.startsWith("/budget") ? CONTENT_MAX.budget : CONTENT_MAX.default;
  // Marks <html> while a field has the keyboard up, for the receipt button.
  useTypingFlag(pathname);
  const receiptTab = useReceiptTabShowing();
  // The phone's tab bar, on the app's top-level pages only: the ones the nav
  // links to, and the profile. A page inside one of them (an utlägg, an
  // event's sheet, a stocktake) has its back arrow instead, the way an iOS app
  // drops its tab bar on a pushed screen. Those are where the typing happens,
  // and a bar fixed to the foot sat on top of the keyboard there; iOS gives a
  // page no way to know the keyboard is up, so the answer is not to have the
  // bar on those pages at all. The top bar's menu button is the way round.
  //
  // Never with a receipt panel either, which wants the foot for its own button.
  const receiptPanel = useReceiptPanelActive();
  const topLevel = pathname === "/profile" || Object.hasOwn(SECTION_LABELS, routePath(pathname));
  const tabBar = topLevel && !receiptPanel;

  return (
    // From md up this is a fixed-height app shell: the frame never moves and the
    // main column is the only thing that scrolls. On a phone that costs more
    // than it gives, because a browser only retracts its address bar and toolbar in
    // response to the *document* scrolling, so a nested scroller means they stay
    // put and eat ~130px of an already small screen for the whole session. Below
    // md the document scrolls normally instead. dvh, not vh: on iOS `100vh` is
    // the toolbars-hidden height, so `h-screen` here would run the layout past
    // the bottom of what you can actually see.
    // On paper none of that applies: the chrome is dropped and the page column
    // is left to flow, or the printer gets one screenful and nothing after it.
    //
    // From md the header spans the whole width, and the page and the receipt
    // stand side by side in the row under it, with the nav lying over them.
    <div className="flex min-h-dvh flex-col md:h-screen md:overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* The first thing the keyboard reaches, and invisible until it does.
          Without it every page begins with a walk through the whole sidebar,
          a dozen-odd links, before the content the reader came for. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:border focus:border-brand-edge focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-[var(--shadow-card)] focus:brand-fill focus:text-on-brand"
      >
        {t("skipToContent")}
      </a>

      {/* The phone's navigation. A sibling of the desktop nav rather than a
          state of it: below md that one is not rendered at all, and this is. */}
      {tabBar && (
        <TabBar user={user} isActive={isActive} counts={counts} onMore={() => setMenuOpen(true)} />
      )}

      <MobileNav
        open={menuOpen}
        onClose={closeNav}
        overview={OVERVIEW}
        groups={groups}
        help={HELP}
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
        navOpen={navOpen}
        navToggleRef={navToggleRef}
        onToggleNav={() => setNavOpen(!navOpen)}
        waiting={Object.values(counts).some((n) => n > 0)}
      />

      <div className="relative flex min-h-0 flex-1 print:block">
        {/* The nav.

            From md it is a panel over the left edge of the row under the
            header, so opening it moves nothing on the page. Slid off to the
            left while shut, and `inert` there so its links are not tab stops
            nobody can see.

            Below md it is not here at all: the phone has a screen of its own
            (components/shell/mobile-nav.tsx) rather than this panel at a
            different width. */}
        <div
          id="app-nav"
          ref={navRef}
          inert={!navOpen}
          className={cn(
            "absolute inset-y-0 left-0 z-30 hidden w-64 print:hidden md:block",
            // `translate` and not `transform`: Tailwind 4's translate-x
            // utilities set the `translate` property, so a transition on
            // `transform` let the panel snap rather than slide.
            "transition-[translate,visibility] duration-250 ease-out",
            navOpen ? "translate-x-0" : "invisible -translate-x-full",
          )}
        >
          <aside className="flex h-full w-64 flex-col border-r border-border bg-background shadow-xl">
            <nav
              aria-label={t("mainNav")}
              // `overscroll-contain`, or scrolling past the end of a short nav
              // list chains into scrolling the main column beside it.
              className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
            >
              <div className="flex flex-col gap-0.5">{navLink(OVERVIEW)}</div>
              {/* The sections, one row each, and the pages inside a section as
                  tabs across the top of each of them (SectionTabs, below). It
                  has been both of the other ways. Disclosures folded every
                  group but the current one, so any other page was two clicks
                  and a folded heading did not say what was in it. Then every
                  page at once, which for the treasury was a list long enough to
                  scroll. One row a section is short for everybody, and the tabs
                  say what is in a section the moment you are in it. */}
              <div className="flex flex-col gap-0.5">
                {groups.map((group) =>
                  navRow({
                    href: group.items[0].href,
                    label: t(group.label),
                    icon: group.icon,
                    active: group.items.some((i) => isActive(i.href)),
                    count: group.items.reduce((n, i) => n + (counts[i.href] ?? 0), 0),
                  }),
                )}
              </div>
              {/* `mt-auto` so it sits at the foot however few groups
                  this user's roles leave above it. Settings pinned beside Help
                  rather than buried in groupAdmin: neither is a job you go do,
                  both are always there. */}
              <div className="mt-auto flex flex-col gap-0.5 pt-4">
                {SETTINGS.visible(user) && navLink(SETTINGS)}
                {navLink(HELP)}
              </div>
            </nav>
          </aside>
        </div>

        {/* Main column, the only scroll container from md up. Below that the
            document itself scrolls, so the browser chrome can get out of the way.

            `overscroll-contain` is what keeps "the only" true. A nested scroller
            that reaches its end hands the rest of the gesture to the nearest
            scrollable ancestor, so carrying on past the bottom of a long page
            started moving something outside this column and the page appeared to
            scroll roughly twice its own height. Containing it ends the gesture
            where the content does.

            Only from md, and deliberately: below md this element does not scroll
            at all, the document does, and containing the document's own overscroll
            is what stops a phone browser retracting its address bar.

            `relative` so that this column, and not the document, is the
            containing block for anything absolutely placed inside a page. An
            `sr-only` label in a button with no positioned ancestor was placed
            against the document instead, 1500px down a long page, where the
            shell's own `overflow-hidden` could not clip it. The document grew to
            fit it, and scrolling over anything outside this column (the
            sidebar's profile footer) scrolled the whole frame off the screen. */}
        <div
          // What scrolls from md up, for anything that has to know whether the
          // page is scrolled (the section band's fade, section-nav.tsx).
          // `overflow-x-hidden` clips the band's divider, which is drawn a
          // viewport wide so it reaches both edges of this column.
          data-main-scroll
          className="relative flex min-w-0 flex-1 flex-col md:overflow-y-auto md:overflow-x-hidden md:overscroll-contain print:overflow-visible"
        >
          {/* Mobile top bar. Its menu button only where the tab bar is not,
              since the tab bar's "Mer" is the same door. */}
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden print:hidden">
            {!tabBar && (
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                aria-label={t("openMenu")}
                className="-ml-1 flex size-9 items-center justify-center rounded-control text-foreground transition-colors hover:bg-hover"
              >
                <IconMenu className="size-5" />
              </button>
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-7" />
            {/* Where you are, not what app this is. The mark beside it already
                answers the second question, and it is the same answer on every
                screen; this is the line a phone's own nav bar spends on the
                screen you are actually looking at. */}
            <p className="min-w-0 flex-1 truncate text-sm font-semibold">{section ?? "D-sektionen"}</p>
            {/* The year here too: it narrows the page as much on a phone. The
                rest of the desktop header is in the menu. */}
            {fiscal && <FiscalYearPicker fiscal={fiscal} />}
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
              "mx-auto w-full flex-1 pl-4 pt-6 md:pl-6",
              // The folded receipt tab is `fixed`, so it reserves no space at all
              // and sits on top of whatever reaches the edge it is on, which is
              // a different edge at each width (receipt/receipt-panel.tsx). Below
              // md it is a strip across the bottom, so the page owes it height;
              // from md it is a tab on the right, so the page owes it width.
              //
              // Each written as one utility or the other, never both: `cn` joins
              // rather than merges, so two `pb-` would be settled by stylesheet
              // order instead of by intent.
              // The tab bar is fixed as well, 56px and the home indicator, so
              // below md the page owes it that much plus its own breathing room.
              // On a phone the folded receipt is a round button in the bottom
              // corner, so the page ends clear of it and the last buttons on it
              // are never under it.
              receiptTab
                ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-20"
                : tabBar
                  ? "pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-20"
                  : "pb-16 md:pb-20",
              receiptTab ? "pr-6 md:pr-12" : "pr-6 md:pr-6",
              // The budget sheets need more room; everything else stays centered.
              caps,
            )}
          >
            {/* The section's band, drawn here rather than by the page so that it
                stays put while the page under it changes. See section-nav.tsx. */}
            <SectionNavProvider
              value={{ nav: sectionNav, slot: sectionSlot, reportOwn: setPageOwn, active: activeSection }}
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

        {/* The receipt, when the open page has one. A sibling of the main column
            rather than something inside it: that's what lets it stand the full
            height of the frame and stay put while the page scrolls. */}
        <ReceiptPanelColumn />
      </div>

    </div>
  );
}
