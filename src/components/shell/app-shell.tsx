"use client";

import { useEffect, useState } from "react";
import { useEscape } from "@/lib/ui/escape";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRole } from "./role-context";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { Avatar } from "../ui/avatar";
import { IconFortnox } from "./fortnox-mark";
import { ReceiptPanelColumn, useReceiptTabShowing } from "../receipt/receipt-panel";
import { MobileNav } from "./mobile-nav";
import { CommandPalette, useCommandPaletteHotkey, type CommandItem } from "./command-palette";
import {
  IconBox,
  IconCalendar,
  IconIncome,
  IconBook,
  IconBudget,
  IconCard,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconContract,
  IconExternal,
  IconGear,
  IconGrid,
  IconHelp,
  IconList,
  IconMenu,
  IconReceipt,
  IconSearch,
  IconUsers,
} from "../ui/icons";
import {
  canAccessBookkeeping,
  canAccessBudget,
  canAccessSettings,
  canManageRentals,
  canViewContracts,
  canViewRentals,
  canViewStock,
  hasAttestRole,
} from "@/lib/domain/permissions";
import type { CurrentUser, FortnoxStatus } from "@/lib/domain/types";
import { SETTINGS_SECTIONS } from "./settings-sections";

import { owningRoute } from "@/lib/ui/routes";
import { cn } from "@/lib/ui/utils";

/** The section's own site, which the mark in the corner goes back to. Not a
 *  route of this app: this app is one thing the section runs. */
const DSEK_URL = "https://dsek.se";

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

export type NavGroup = {
  label: string;
  /** What the collapsed header row shows instead of one of its items' own
   *  icons: a group is a category, not a page, and reusing the first item's
   *  icon for it would be an accident of list order rather than a choice
   *  about what the category is. */
  icon: (p: { className?: string }) => React.ReactNode;
  items: NavItem[];
};

const ALL = () => true;

// How wide the main column may grow. One cap per section, not two: what the
// rail costs the row is a constant 64px, and the panel it opens into overlays
// the page rather than widening the column it stands beside, so there is no
// width being handed back and forth for the content to compensate for.
const CONTENT_MAX = {
  budget: "max-w-[1792px]",
  default: "max-w-[1472px]",
};

/**
 * The nav is a 64px rail of icons that widens to 256px of labelled links on
 * hover, and stays there if you pin it.
 *
 * It was a 16px strip of screen edge with a hairline on it, opening the same
 * panel. That bought the 13" layout its width back. With the intäkter list at
 * 256, the receipt at ~520 and the frame's own gutters, a permanent 256px
 * sidebar left the booking form around 320px. But tested on people who hadn't
 * been shown it, the hairline simply wasn't found. Worse than the navigation
 * being hard to reach: with the panel shut there was no current-section marker,
 * no brand, and no way to profile, theme, language or sign-out at all, since
 * all of those live at the foot of this panel.
 *
 * 64px is what fixes that for the price of one icon column. The booking form
 * goes 576 → 512, which is the same `@md` tier of its container query
 * (`@3xl` doesn't start until 768), so nothing on the page reflows to pay for
 * it.
 *
 * Widths are written out as literal classes at each place they are needed
 * rather than shared through a constant: Tailwind reads these out of the source
 * as text and never sees a template string.
 */
export const NAV_PINNED_COOKIE = "nav_pinned";

// Where settings lands, and the prefix that switches the sidebar over to the
// settings nav.
const SETTINGS_ROOT = "/admin";
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
        visible: (u) => u.holdsCard || canAccessBookkeeping(u.capabilities),
      },
      { href: "/approvals", label: "approvals", icon: IconCheck, visible: (u) => hasAttestRole(u.capabilities) },
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
    label: "groupBookkeeping",
    icon: IconBook,
    items: [
      {
        href: "/bookkeeping",
        label: "bookkeeping",
        icon: IconBook,
        visible: (u) => canAccessBookkeeping(u.capabilities),
      },
      {
        href: "/income",
        label: "income",
        icon: IconIncome,
        visible: (u) => canAccessBookkeeping(u.capabilities),
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
      {
        href: "/stock/log",
        label: "stockLog",
        icon: IconList,
        visible: (u) => canViewStock(u.capabilities),
      },
      // Last in the group, because it is the one you open to look rather than
      // to do: the three above are where the work happens.
      {
        href: "/stock/stats",
        label: "stockStats",
        icon: IconChart,
        visible: (u) => canViewStock(u.capabilities),
      },
    ],
  },
  {
    label: "groupRental",
    icon: IconContract,
    items: [
      // Its own group rather than a corner of Avtal, for the same reason
      // Alkohollager is not a corner of Bokföring: it is a different job done
      // by different people. The archive answers "which agreements do we have";
      // this answers "where is the gear", and somebody with a store room needs
      // the second question to have a home.
      {
        href: "/uthyrning",
        label: "rentals",
        icon: IconContract,
        visible: (u) => canViewRentals(u.capabilities),
      },
      // The catalogue lives here rather than in Inställningar, where it started.
      // /stock holds the products and Inställningar → Lager holds only the
      // bookkeeping accounts; a list of the section's own things is not
      // configuration of the app.
      {
        href: "/uthyrning/utrustning",
        label: "rentalItems",
        icon: IconBox,
        visible: (u) => canManageRentals(u.capabilities),
      },
    ],
  },
  {
    label: "groupAdmin",
    icon: IconGear,
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
      // choice /uthyrning/utrustning makes for the gear catalogue: a list of
      // who the section has agreed with is not configuration of the app.
      {
        href: "/contracts/counterparties",
        label: "counterparties",
        icon: IconUsers,
        visible: (u) => canManageRentals(u.capabilities),
      },
      { href: SETTINGS_HOME, label: "settings", icon: IconGear, visible: (u) => canAccessSettings(u.capabilities) },
    ],
  },
];

// Settings replace the app nav rather than nesting inside it. A settings
// section may need its own list-and-detail layout, and with the app nav still
// in place that would be a third column, so while the path is under /admin the
// sidebar shows these instead, with a way back at the top.
// Built from the same list the landing page lays out as cards, so a section
// cannot be added to one and forgotten in the other. See ./settings-sections.
const SETTINGS_NAV: NavGroup[] = [
  {
    label: "settings",
    icon: IconGear,
    items: SETTINGS_SECTIONS.map((s) => ({
      href: s.href,
      label: s.label,
      icon: s.icon,
      visible: ALL,
    })),
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
 */
export const SECTION_LABELS: Record<string, string> = Object.fromEntries(
  [
    OVERVIEW,
    HELP,
    ...NAV_GROUPS.flatMap((g) => g.items),
    ...SETTINGS_NAV.flatMap((g) => g.items),
  ].map((item) => [item.href, item.label]),
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
  defaultPinned = false,
  fortnox,
}: {
  children: React.ReactNode;
  /** The stored pin, read from the cookie by the layout so a pinned nav renders
   *  pinned on the first paint rather than snapping wide after hydration. */
  defaultPinned?: boolean;
  /**
   * The reader's own Fortnox login, when they are one of the roles that books
   * under one. Absent for everybody else, and the nav shows nothing: the row
   * is an action only the treasury can take. A present-but-null session is
   * signed out. See the foot of the nav.
   */
  fortnox?: { session: FortnoxStatus["session"] | null };
}) {
  const pathname = usePathname();
  const { user } = useRole();
  const t = useTranslations("nav");
  // Two flags, because there are now two navs and they are not the same thing
  // held open at two widths.
  //
  // `pinned` is the rail's, and only the rail's: a standing preference about
  // the shape of the desktop frame, restored from a cookie so a pinned nav
  // renders pinned on the first paint. Hovering opens the panel too, but only
  // in CSS (see the aside). A hover that re-rendered the whole shell on the
  // way in and out would be paying React for what the compositor already does.
  const [pinned, setPinned] = useState(defaultPinned);

  // The phone's menu, which always starts shut. It used to share `pinned`, and
  // that quietly meant a reader who had pinned the rail on a laptop arrived on
  // their phone with the menu open over every page. The cookie is a fact about
  // a frame that does not exist below md.
  const [menuOpen, setMenuOpen] = useState(false);

  // Which groups the reader has opened or closed by hand, against the
  // default of "whichever one owns the page you're on is open, the rest
  // aren't" (see `owning` below). A group with no entry here follows that
  // default; one that does follows the reader instead, which is what lets
  // the active group be folded too rather than being the one row that can't
  // be. Keyed by an explicit true/false rather than a set of "opened", since
  // the default it is overriding is not the same for every group.
  //
  // Starts empty rather than seeded from a cookie: with seven groups and the
  // active one already shown, there is no first-paint flash to avoid the way
  // there is for `pinned`, and which ones somebody last folded or opened is a
  // browsing habit, not a standing preference about the shape of the frame.
  const [groupOverride, setGroupOverride] = useState<Record<string, boolean>>({});
  const toggleGroup = (label: string, currentlyOpen: boolean) =>
    setGroupOverride((prev) => ({ ...prev, [label]: !currentlyOpen }));

  // Cmd/Ctrl+K, wherever the reader is: a collapsed group or a folded phone
  // menu should not cost this its own way in. See command-palette.tsx.
  const [paletteOpen, setPaletteOpen] = useState(false);
  useCommandPaletteHotkey(() => setPaletteOpen(true));

  const togglePin = () => {
    setPinned((v) => {
      const next = !v;
      document.cookie = `${NAV_PINNED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
      return next;
    });
  };

  // Escape closes whichever of them is open, and only the topmost layer hears
  // it, since a combobox inside the menu answers first. See lib/ui/escape.ts.
  useEscape(menuOpen, () => setMenuOpen(false));
  useEscape(pinned && !menuOpen, () => setPinned(false));

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
  // navigable thing inside it closes it on the way out. Harmless from md, where
  // nothing is open: the rail's pin is a preference about the frame, and
  // navigating is not a request to undo it.
  const closeNav = () => setMenuOpen(false);

  // Everything in the panel that is text rather than icon fades with the width,
  // so a label is never caught halfway through the rail's edge. Below md there
  // is no rail, because the panel is the full-width drawer, so the base state is
  // "shown" and only md up hides it; open, the panel is simply open and none of
  // it applies.
  //
  // The opacity states only. The `transition-*` belongs to each place this is
  // used, because one of them is also transitioning a transform and `cn` joins
  // classes rather than merging them: `transition-opacity` alongside
  // `transition-transform` is not both, it is whichever Tailwind emitted last.
  //
  // These all track the panel's width, so they open on the same things it does
  // and on nothing else, which is what the `nav-open` variant is: one place
  // that says what "open" means, instead of `md:group-hover:X` and
  // `md:group-has-[:focus-visible]:X` written out beside every value. See
  // globals.css.
  const labelFade = pinned
    ? ""
    : "md:opacity-0 md:nav-open:opacity-100";

  // Sits in the header row past the rail's edge, so while collapsed it is both
  // invisible and out of reach rather than an invisible click target hanging
  // over the intäkter list.
  const pinButton = pinned
    ? "transition-opacity"
    : "pointer-events-none opacity-0 transition-opacity md:nav-open:pointer-events-auto md:nav-open:opacity-100";

  // The quick switches at the foot. Unlike a label, these are rows of their own,
  // so fading them would leave the rail with 80px of blank footer above the
  // avatar and the avatar itself off the bottom of a phone-height panel. They
  // have to give the height back too, hence a collapsing grid row rather than
  // an opacity, which gets there without a hardcoded height that would have to
  // be re-measured every time a switch changes size.
  const switchReveal = pinned
    ? "grid-rows-[1fr]"
    : "md:grid-rows-[0fr] md:nav-open:grid-rows-[1fr]";

  // The Fortnox box at the foot: a 36px square on the rail, holding nothing but
  // the mark, that opens into a full-width button with its label inside it. A
  // width rather than a fade, because the border is the box. Fading a label in
  // and out of a box that stayed 36px wide would put the text outside it.
  //
  // `calc(100% - 4px)` and not `w-full`: the box carries the profile row's own
  // 2px inset so its square stands where the avatar stands, and a full-width
  // element with margins on it would hang those 4px off the right of every
  // other row in the panel.
  const fortnoxBox = pinned
    ? "w-[calc(100%-4px)]"
    : cn(
        "w-[calc(100%-4px)] md:w-9",
        "md:nav-open:w-[calc(100%-4px)]",
      );

  // And its dot travels with the width: badged on the corner of the square
  // while it is one, and once there is a box to sit in, in from the trailing
  // edge on the centre line, where the same dot sits on /profile. `top` and
  // `right` both animate, so it takes the same 200ms the panel does and arrives
  // with it rather than jumping when the transition ends.
  const fortnoxDot = pinned
    ? "top-1/2 right-[15px]"
    : cn(
        "top-1/2 right-[15px]",
        "md:top-0 md:right-0",
        "md:nav-open:top-1/2 md:nav-open:right-[15px]",
      );

  // Exactly one row is lit, and it is the section that owns this page rather
  // than every section whose route is a prefix of it. The two exceptions this
  // used to carry are gone with the prefix test that needed them: /dashboard
  // was excluded so it would not swallow everything under it, and
  // "/expenses/new" was never a nav route at all, so that clause could not
  // fire.
  const activeSection = sectionHref(pathname);
  const isActive = (href: string) => href === activeSection;

  const navLink = (item: NavItem) => {
    const Icon = item.icon;
    const label = t(item.label);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={closeNav}
        // `px-[11px]`, not `px-3`: the nav's own `px-3` leaves a 40px row on the
        // rail, and 11 + the 18px icon + 11 is exactly that, so the icon sits
        // on the rail's centre line and stays on it, to the pixel, as the panel
        // widens around it. Nothing about the row moves; only the label arrives.
        className={cn(
          "flex items-center rounded-xl px-[11px] py-2 text-sm font-medium transition-colors",
          isActive(item.href)
            ? "brand-fill text-on-brand"
            : "text-foreground hover:bg-hover",
        )}
      >
        <Icon className="size-[18px] shrink-0" />
        {/* Margin rather than the row's `gap`, which would be spent whether or
            not there is a label to separate: 12px of it, on a row with 0 to
            spare, pushing the icon off the centre line every time the panel
            closed. As a margin it simply overflows the rail with the label and
            is clipped along with it.

            No `title` on any of this: the tooltip's own delay is longer than
            the width transition, so the label it would repeat is already on
            screen before it could appear. */}
        <span className={cn("ms-3 min-w-0 flex-1 truncate transition-opacity", labelFade)}>{label}</span>
      </Link>
    );
  };

  // Under /admin the sidebar belongs to settings. See SETTINGS_NAV.
  const inSettings = pathname.startsWith(SETTINGS_ROOT);

  const groups = (inSettings ? SETTINGS_NAV : NAV_GROUPS)
    .map((group) => ({
      ...group,
      items: group.items.filter((i) => i.visible(user)),
    }))
    .filter((group) => group.items.length > 0);

  // The same answer the sidebar highlights with, spelled out. The top bar and
  // the lit row cannot disagree if they are the one lookup.
  const sectionKey = activeSection === null ? null : SECTION_LABELS[activeSection];
  const section = sectionKey ? t(sectionKey) : null;

  const caps = pathname.startsWith("/budget") ? CONTENT_MAX.budget : CONTENT_MAX.default;
  const receiptTab = useReceiptTabShowing();

  // Every destination the palette can jump to, regardless of which nav (app
  // or settings) is standing in the sidebar right now and regardless of which
  // groups are collapsed there: typing is a way past both of those, not
  // another view of whichever one is currently open. Settings' own pages are
  // included whenever the reader may reach /admin at all, the same gate the
  // "Inställningar" row itself is behind, so a page that is not a link
  // anywhere for this reader is not a search result either.
  const paletteItems: CommandItem[] = [
    { href: OVERVIEW.href, label: t(OVERVIEW.label), group: "", icon: OVERVIEW.icon },
    ...NAV_GROUPS.flatMap((group) =>
      group.items
        .filter((i) => i.visible(user))
        .map((i) => ({ href: i.href, label: t(i.label), group: t(group.label), icon: i.icon })),
    ),
    ...(canAccessSettings(user.capabilities)
      ? SETTINGS_NAV[0].items.map((i) => ({
          href: i.href,
          label: t(i.label),
          group: t(SETTINGS_NAV[0].label),
          icon: i.icon,
        }))
      : []),
    { href: HELP.href, label: t(HELP.label), group: "", icon: HELP.icon },
  ];

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
    <div className="flex min-h-dvh md:h-screen md:overflow-hidden print:block print:h-auto print:overflow-visible">
      {/* The first thing the keyboard reaches, and invisible until it does.
          Without it every page begins with a walk through the whole sidebar,
          a dozen-odd links, before the content the reader came for. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-brand-edge focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-[var(--shadow-card)] focus:brand-fill focus:text-on-brand"
      >
        {t("skipToContent")}
      </a>

      {/* The phone's navigation. A sibling of the rail rather than a state of
          it: below md the rail is not rendered at all, and this is. */}
      <MobileNav
        open={menuOpen}
        onClose={closeNav}
        overview={inSettings ? null : OVERVIEW}
        groups={groups}
        help={HELP}
        inSettings={inSettings}
        isActive={isActive}
        user={user}
        fortnox={fortnox}
      />

      {/* The nav.

          From md the wrapper is a real column in the flex row, and it is the
          only part of this that costs the main column anything: 64px while the
          rail is collapsed, 256 while it is pinned. The panel inside is
          `absolute`, so widening it on hover overflows the column and passes
          over the page instead of shoving it sideways. A page that reflowed
          every time the pointer crossed the nav would be unusable.

          Below md it is not here at all: the phone has a screen of its own
          (components/shell/mobile-nav.tsx) rather than this panel at a
          different width, because everything about this one is measured for a
          64px rail and a pointer. */}
      <div
        className={cn(
          "group pointer-events-none hidden print:hidden",
          "md:block md:pointer-events-auto md:relative md:z-30 md:shrink-0",
          "md:transition-[width] md:duration-200 md:ease-out",
          pinned ? "md:w-64" : "md:w-16",
        )}
      >
        <aside
          className={cn(
            "pointer-events-auto absolute inset-y-0 left-0 z-40 flex w-64 flex-col bg-background",
            // Everything that only exists at 256px (labels, the brand wordmark,
            // the pin button) is laid out at full width and hangs off the right
            // of the rail. This is what cuts it off at the edge.
            "overflow-hidden border-r border-border",
            "transition-[width,transform,box-shadow] duration-200 ease-out",
            pinned
              ? // Standing in the row rather than over the page: a border is
                // enough, and a shadow would draw a seam down a frame that no
                // longer has one.
                "translate-x-0 md:w-64"
              : cn(
                  // Below md this is the drawer, parked off-screen until the
                  // hamburger sets `pinned`. From md it never moves: it is
                  // always on screen as the rail, and opening is a width.
                  "-translate-x-full shadow-[var(--shadow-card)]",
                  "md:w-16 md:translate-x-0 md:shadow-none",
                  // The reveal itself: the panel's width is what every other
                  // `nav-open` class below tracks. Hover, and the keyboard's
                  // way in, because tabbing to a link whose label is still
                  // clipped would otherwise walk the reader through a menu they
                  // cannot read. See the `nav-open` variant in globals.css for
                  // why it is `:focus-visible` and not `:focus-within`.
                  "md:nav-open:w-64 md:nav-open:shadow-xl",
                ),
          )}
        >
          {/* The header, in the same two-part shape as every row below it: one
              40px slot on the rail's centre line that is always visible, and
              text after it that arrives with the width. */}
          <div className="flex h-16 shrink-0 items-center px-3">
            {inSettings ? (
              <Link
                href="/dashboard"
                onClick={closeNav}
                className="flex min-w-0 flex-1 items-center rounded-xl py-2 text-sm font-medium text-muted transition-colors hover:text-foreground"
              >
                <span className="flex size-10 shrink-0 items-center justify-center">
                  <IconChevronDown className="size-4 rotate-90" />
                </span>
                <span className={cn("ms-1 min-w-0 flex-1 truncate transition-opacity", labelFade)}>
                  {t("backToApp")}
                </span>
              </Link>
            ) : (
              /* The brand is the way back to the section's own site. It is
                 the oldest convention there is (the mark in the corner goes
                 home) and here home is not this app: this app is one thing the
                 section runs, and dsek.se is the section. A new tab, because
                 leaving takes somebody out of a form they may be halfway
                 through, and `rel` because a tab we opened must not be handed
                 a way to steer the one it came from. */
              <a
                href={DSEK_URL}
                target="_blank"
                rel="noreferrer noopener"
                title={t("toDsek")}
                className="group/brand flex min-w-0 flex-1 items-center rounded-xl transition-colors hover:text-foreground"
              >
                <span className="flex size-10 shrink-0 items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/symbol_rosa.svg" alt="" className="h-8" />
                </span>
                <div className={cn("ms-1 min-w-0 flex-1 leading-tight transition-opacity", labelFade)}>
                  {/* Underlined on hover, because nothing else here says the
                      mark is a link. The logo alone is a convention people
                      follow without being told, and only after they have tried
                      it once. */}
                  <p className="truncate text-sm font-semibold group-hover/brand:underline">
                    D-sektionen
                    {/* The mark that says this one leaves the app. On the
                        collapsed rail there is no room for it and no label for
                        it to belong to, so it arrives with the width, like
                        every other label here. */}
                    <IconExternal
                      aria-hidden
                      className="ms-1 inline size-3 align-baseline text-muted transition-opacity group-hover/brand:text-foreground"
                    />
                  </p>
                  <p className="truncate text-xs text-muted">{t("brandTagline")}</p>
                </div>
                {/* The name of the destination, for a reader who cannot see
                    the mark or the logo. The visible text says "D-sektionen",
                    which is where it goes but not that it goes anywhere. */}
                <span className="sr-only">{t("toDsek")}</span>
              </a>
            )}

            {/* Turns a hover into a decision. Without it the wide layout is only
                ever borrowed, because every trip to the nav costs the page 192px
                of cover, and on a screen with the room to spare there is no
                reason to keep paying that. It only appears once the panel is
                open, which is the one moment it has somewhere to be. */}
            <button
              type="button"
              onClick={togglePin}
              aria-expanded={pinned}
              title={pinned ? t("collapseMenu") : t("pinMenu")}
              aria-label={pinned ? t("collapseMenu") : t("pinMenu")}
              className={cn(
                "-me-1 hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-foreground md:flex",
                pinButton,
              )}
            >
              {pinned ? <IconChevronLeft className="size-4" /> : <IconMenu className="size-4" />}
            </button>
          </div>

          <nav
            aria-label={t("mainNav")}
            // `overflow-y-auto` and nothing horizontal: the labels overflowing
            // the rail are meant to be clipped, and a scrollbar offering to
            // reach them would be offering to scroll the frame sideways.
            // `overscroll-contain`, or scrolling past the end of a short nav
            // list chains into scrolling the main column behind the rail.
            className="flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2"
          >
            {/* First in the list, above Översikt: a search is where a reader
                who already knows where they're going looks first, not
                something to find at the bottom of the thing it replaces the
                need to scan. Shown in both navs, settings included, since
                typing three letters beats opening a group to find one page
                whichever list is standing here right now. */}
            <div className="flex flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="flex items-center rounded-xl px-[11px] py-2 text-sm font-medium text-foreground transition-colors hover:bg-hover"
              >
                <IconSearch className="size-[18px] shrink-0 text-muted" />
                <span className={cn("ms-3 min-w-0 flex-1 truncate transition-opacity", labelFade)}>
                  {t("search")}
                </span>
                {/* The shortcut, not a repeat of the label: once the panel is
                    wide enough to read either, the word beside the icon
                    already says what the button does, and this says how to
                    reach it without one. */}
                <kbd
                  aria-hidden
                  className={cn(
                    "ms-2 shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-faint transition-opacity",
                    labelFade,
                  )}
                >
                  ⌘K
                </kbd>
              </button>
            </div>
            {!inSettings && <div className="flex flex-col gap-0.5">{navLink(OVERVIEW)}</div>}
            {groups.map((group) => {
              // The group the current page belongs to defaults to open, so
              // arriving on a page never buries it, but it is still only a
              // default: a reader who wants the sidebar out of the way while
              // they work can fold it like any other, and `groupOverride`
              // remembers that they did.
              const owning = group.items.some((i) => isActive(i.href));
              const open = groupOverride[group.label] ?? owning;
              const GroupIcon = group.icon;
              return (
                <div key={group.label} className="flex flex-col gap-0.5">
                  {/* A disclosure button now, not a decoration: with seven
                      groups and a couple dozen items between them, listing
                      every row of every group at once was the sidebar this
                      exists to shorten. Only the one the current page owns
                      (and whichever others were opened by hand) still lists
                      its pages; the rest collapse to this one row.

                      Carries the group's own icon rather than one borrowed
                      from whichever item happens to be listed first: a
                      category is its own thing, not an accident of list
                      order, and a folded group otherwise has nothing on it
                      but a bare arrow, indistinguishable from every other
                      folded group at a glance. Same size and the same
                      `px-[11px]` inset as an item row below it, so the icon
                      column lines up whether the row it lands on is a group
                      or a page.

                      The chevron moves to the trailing edge and fades in
                      with the label: at rail width there is no room to read
                      either, and the icon alone is what identifies the row
                      there, the same as it does for every item. Wide, the
                      chevron is what says the icon's row is a disclosure and
                      not a link. */}
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label, open)}
                    aria-expanded={open}
                    className="flex items-center rounded-xl px-[11px] py-2 text-left transition-colors hover:bg-hover"
                  >
                    <GroupIcon className="size-[18px] shrink-0 text-muted" />
                    <span
                      className={cn(
                        "ms-3 min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wider text-muted transition-opacity",
                        labelFade,
                      )}
                    >
                      {t(group.label)}
                    </span>
                    <IconChevronRight
                      aria-hidden
                      className={cn(
                        "ms-2 size-3.5 shrink-0 text-muted transition-[transform,opacity] duration-200",
                        open && "rotate-90",
                        labelFade,
                      )}
                    />
                  </button>
                  {/* Animated open the same way the profile footer's own
                      switches are (see `switchReveal`): a grid whose one row
                      tweens between 0fr and 1fr, clipped by the child that
                      holds the overflow while it does. `grid-template-rows`
                      rather than `height`, because these rows do not have a
                      fixed height to animate to or from; `0fr → 1fr` reaches
                      whatever that height turns out to be without measuring
                      it in JS first.

                      Unlike the footer's switches, this collapse has nothing
                      to do with the rail's own width, so there is no
                      `:focus-visible` rule anywhere that would widen the
                      panel and reveal a hidden row the instant Tab reached
                      it. `inert` is what stands in for that here: a collapsed
                      group's links leave the tab order and the accessibility
                      tree entirely, rather than sitting invisibly in either
                      of them. */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-200 ease-out",
                      open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div inert={!open} className="flex flex-col gap-0.5">
                        {group.items.map(navLink)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {/* `mt-auto` so it sits against the profile footer however few groups
                this user's roles leave above it. */}
            <div className="mt-auto flex flex-col gap-0.5 pt-4">{navLink(HELP)}</div>
          </nav>

          {/* Sticky profile footer */}
          <ProfileFooter
            user={user}
            onNavigate={closeNav}
            labelFade={labelFade}
            switchReveal={switchReveal}
            fortnox={fortnox}
            fortnoxBox={fortnoxBox}
            fortnoxDot={fortnoxDot}
          />
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
          is what stops a phone browser retracting its address bar. */}
      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto md:overscroll-contain print:overflow-visible">
        {/* Mobile top bar: the only way to reach the nav below md. */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden print:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("openMenu")}
            className="-ml-1 flex size-9 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-hover"
          >
            <IconMenu className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/symbol_rosa.svg" alt="D-sektionen" className="h-7" />
          {/* Where you are, not what app this is. The mark beside it already
              answers the second question, and it is the same answer on every
              screen; this is the line a phone's own nav bar spends on the
              screen you are actually looking at. */}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{section ?? "D-sektionen"}</p>
          {/* No keyboard to press Cmd/Ctrl+K on down here, so the palette
              needs a tap target of its own rather than only the sidebar row
              that opens it on a wider screen. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label={t("search")}
            className="-mr-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-hover"
          >
            <IconSearch className="size-5" />
          </button>
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
            "mx-auto w-full flex-1 pl-4 pt-6 md:pl-6 md:pt-8",
            // The folded receipt tab is `fixed`, so it reserves no space at all
            // and sits on top of whatever reaches the edge it is on, which is
            // a different edge at each width (receipt/receipt-panel.tsx). Below
            // md it is a strip across the bottom, so the page owes it height;
            // from md it is a tab on the right, so the page owes it width.
            //
            // Each written as one utility or the other, never both: `cn` joins
            // rather than merges, so two `pb-` would be settled by stylesheet
            // order instead of by intent.
            receiptTab ? "pb-32 md:pb-20" : "pb-16 md:pb-20",
            receiptTab ? "pr-6 md:pr-12" : "pr-6 md:pr-6",
            // The budget sheets need more room; everything else stays centered.
            caps,
          )}
        >
          {children}
        </main>
      </div>

      {/* The receipt, when the open page has one. A sibling of the main column
          rather than something inside it: that's what lets it stand the full
          height of the frame and stay put while the page scrolls. */}
      <ReceiptPanelColumn />

      {paletteOpen && (
        <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

/**
 * The treasury's own Fortnox login, as the button directly above the profile.
 *
 * It sits there rather than up among the nav links because it is not a section
 * of the app to be in. It is the state of an account, next to the account it
 * belongs to. On the rail it is a 36px square holding the mark, standing where
 * the avatar below it stands; as the panel opens the square grows into a
 * full-width button and its label arrives inside the border rather than beside
 * it, which is what makes it read as one object opening rather than an icon
 * that has grown a caption.
 *
 * A plain `<a>`, not a `<Link>`: /api/fortnox/connect is a redirect out to
 * Fortnox's consent screen, and routing it through the client router would ask
 * Next to render a page that is never going to arrive.
 *
 * It stays on screen signed in as well as signed out, and the dot says which.
 * The session is short-lived by design, so a button that only appeared once it
 * had lapsed would be one nobody could get ahead of. You would meet it for the
 * first time on the export that failed. Signed in it is quiet and still
 * clickable, which is how you renew a session that is about to go.
 */
function FortnoxLogin({
  session,
  returnTo,
  onNavigate,
  labelFade,
  boxExpand,
  dotSlide,
}: {
  session: FortnoxStatus["session"] | null;
  /** Where to come back to. Fortnox sends the browser here, not back through
   *  history, so without this every login lands on /bookkeeping. */
  returnTo: string;
  onNavigate: () => void;
  labelFade: string;
  /** How the box goes from square to button. See AppShell. */
  boxExpand: string;
  /** Where the dot rides at each of those widths. The same. */
  dotSlide: string;
}) {
  const t = useTranslations("nav");
  const signedIn = Boolean(session);
  const label = signedIn ? t("fortnoxSignedIn") : t("fortnoxSignIn");
  return (
    <a
      href={`/api/fortnox/connect?mode=user&returnTo=${encodeURIComponent(returnTo)}`}
      onClick={onNavigate}
      title={label}
      // `mx-0.5`, the profile row's own inset, so the square stands in exactly
      // the 36px the avatar below it stands in. Outlined rather than filled:
      // the border is what makes it a box for the label to be inside, and the
      // fill is left to the hover, like every other row in this panel.
      //
      // `mb-2` to match the gap above it, so the button sits between the
      // switches and the profile rather than stuck to the profile. Two bordered
      // 36px squares touching read as one control split in half, which on the
      // rail, where both are squares and neither is labelled, is exactly the
      // wrong thing for a login to be mistaken for.
      //
      // No `overflow-hidden`, deliberately. The dot hangs off the corner while
      // the box is a square, and clipping the box would take it with it.
      className={cn(
        "relative mx-0.5 mb-2 flex h-9 items-center rounded-lg border border-border transition-[width,background-color] duration-200 ease-out hover:bg-hover",
        boxExpand,
      )}
    >
      {/* A 36px slot, the avatar's size, so the mark lands on the same centre
          line, and the label after it starts where the name below it does. It
          is a pixel wider each side than the box's inside, which nothing can
          show: what is drawn in it is a 20px logo in the middle. */}
      <span className="flex size-9 shrink-0 items-center justify-center">
        <IconFortnox className="size-5" />
      </span>
      <span
        className={cn(
          "ms-3 min-w-0 flex-1 truncate pe-6 text-sm font-medium transition-opacity",
          labelFade,
        )}
      >
        {label}
      </span>
      <span
        aria-hidden
        // Positioned by its centre, the translate being half of it on each axis,
        // so the corner badge and the seat inside the box are the same two
        // numbers moving, and `top`/`right` can simply be animated between
        // them. Ringed in the panel's background to keep it off the border it
        // crosses.
        //
        // Warning rather than the muted grey the same state wears on /profile:
        // there the dot reports, with a sentence beside it saying what it
        // means, and here, clipped to a 64px rail most of the time, it is the
        // whole message, and the message is that an export will fail until
        // somebody presses this.
        className={cn(
          "absolute size-2.5 -translate-y-1/2 translate-x-1/2 rounded-full ring-2 ring-background transition-[top,right] duration-200 ease-out",
          signedIn ? "bg-success" : "bg-warning",
          dotSlide,
        )}
      />
    </a>
  );
}

// Bottom-of-sidebar profile: the two switches that are worth reaching without
// leaving the page (theme and language) over a row that says whose session
// this is and leads to /profile, where the rest of it lives (payout account,
// roles, Fortnox login, sign-out).
//
// This was a popover opening upward out of the footer, carrying all of that in
// miniature. Two things were wrong with it. It stood over the panel's foot and
// could not be reached without the pointer leaving the panel, so the panel had
// to be held open behind it, and a menu that outlives the hover that opened it
// is a menu that snags, still standing over the page long after you have moved
// on. And it was a second copy of /profile, which is a page that already exists
// and is one click from here. What is left inline is only what a page load
// would be too much for.
function ProfileFooter({
  user,
  onNavigate,
  labelFade,
  switchReveal,
  fortnox,
  fortnoxBox,
  fortnoxDot,
}: {
  user: CurrentUser;
  onNavigate: () => void;
  /** How the panel's text behaves as the rail widens. See AppShell. */
  labelFade: string;
  /** The same, for the switch rows, which give back their height too. */
  switchReveal: string;
  /** The reader's own Fortnox login, for the roles that book under one.
   *  Absent for everybody else, and no button is drawn. */
  fortnox?: { session: FortnoxStatus["session"] | null };
  /** How that button opens, and where its dot rides. See AppShell. */
  fortnoxBox: string;
  fortnoxDot: string;
}) {
  const { name, email, initials } = user;
  const t = useTranslations("common");
  const tNav = useTranslations("nav");
  const pathname = usePathname();
  const onProfile = pathname === "/profile";

  return (
    <div className="border-t border-border p-3">
      {/* Collapsed to nothing on the rail rather than merely faded: at 64px
          there is no room for a label beside a 36px control, and a switch you
          cannot see is still a switch you can hit. Tabbing to one from the
          keyboard opens the panel around it. `switchReveal` answers to
          `:focus-visible` the same way the labels do. */}
      <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", switchReveal)}>
        {/* The clip the collapsing row needs to close over. */}
        <div className="overflow-hidden">
          <div className={cn("space-y-1 pb-2 transition-opacity", labelFade)}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted">{t("theme")}</span>
              <ThemeToggle />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs text-muted">{t("language")}</span>
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </div>

      {/* Directly above the profile, and never inside the collapsing block
          above: the switches are a convenience that the rail can afford to
          fold away, and this is a warning that it cannot. */}
      {fortnox && (
        <FortnoxLogin
          session={fortnox.session}
          returnTo={pathname}
          onNavigate={onNavigate}
          labelFade={labelFade}
          boxExpand={fortnoxBox}
          dotSlide={fortnoxDot}
        />
      )}

      {/* On the rail this is the whole footer: a 36px avatar on the centre line,
          and the one thing on a collapsed nav that says whose session this is.
          A link, not a menu. Everything it used to open is on the page it
          goes to. */}
      <Link
        href="/profile"
        onClick={onNavigate}
        aria-current={onProfile ? "page" : undefined}
        title={name}
        // `px-0.5` centres the 36px avatar in the 40px the rail's padding
        // leaves, the same way the nav rows centre their icons.
        className={cn(
          "flex w-full items-center rounded-xl px-0.5 py-2 text-left transition-colors",
          // Deliberately not the nav rows' brand fill. Those mark which section
          // of the app you are in; this is a corner of the frame, and a block of
          // brand colour under the avatar reads as a notification rather than as
          // "you are here".
          onProfile ? "bg-surface" : "hover:bg-hover",
        )}
      >
        <Avatar initials={initials} />
        <div className={cn("ms-3 min-w-0 flex-1 leading-tight transition-opacity", labelFade)}>
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="truncate text-xs text-muted">{email}</p>
        </div>
        <IconChevronRight
          aria-hidden
          className={cn("size-4 shrink-0 text-muted transition-opacity", labelFade)}
        />
        <span className="sr-only">{tNav("profile")}</span>
      </Link>
    </div>
  );
}
