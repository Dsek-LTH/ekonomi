"use client";

// The section a page belongs to: its name, and its pages as tabs across the
// top. Drawn by the shell (SectionBand), once, above whichever page is open.
//
// It used to be drawn by every page's own header. That put the band inside the
// page, so a click on a tab replaced the band along with everything else: the
// line under the current tab could not slide because there was no line that
// stayed, the loading placeholder needed a copy of the band, and the two had
// to be kept the same height or the page jumped. Above the page, in the shell,
// it simply stays, and a tab is a change of one class.
//
// The one thing a page still puts in the band is its own switch (Mina / Alla),
// which belongs on the tabs' line. It is portaled there (PageHeader), so the
// page keeps owning it: its state and callbacks stay the page's.
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { PageTitle } from "@/components/shell/settings-title";
import { cn } from "@/lib/ui/utils";
import { NavCount } from "./nav-count";

export interface SectionNav {
  /** The section's name, which is the heading on its own pages. */
  label: string;
  tabsLabel: string;
  tabs: {
    href: string;
    label: string;
    /** The page's own icon from the nav, so a tab and its rail row match. */
    icon: (p: { className?: string }) => React.ReactNode;
    active: boolean;
    count: number;
  }[];
  /** On one of the section's own pages, rather than somewhere under one. */
  root: boolean;
}

const Ctx = createContext<{
  nav: SectionNav | null;
  slot: HTMLElement | null;
  /** The page says whether it is one of the section's own (see PageHeader). */
  reportOwn: (own: boolean | null) => void;
  /** The nav route the page is lit under, which for a page reached from
   *  several sections is the one you came from. See carriedSection. */
  active: string | null;
}>({
  nav: null,
  slot: null,
  reportOwn: () => {},
  active: null,
});
export const SectionNavProvider = Ctx.Provider;

/** The nav route this page is lit under (`/approvals` for an utlägg opened
 *  from the attest queue). */
export function useActiveSection(): string | null {
  return useContext(Ctx).active;
}

/**
 * The band at the top of the main column, for a page in a section: the
 * section's name on its own pages, its tabs, and a slot at the end of the tabs'
 * line for the page's switch (see PageHeader). Sticky, blurred behind, the way
 * the utlägg form's action bar sits at the foot.
 */
export function SectionBand({
  section,
  own,
  slotRef,
}: {
  section: SectionNav;
  /** One of the section's own pages: the name is the heading. */
  own: boolean;
  slotRef: (el: HTMLElement | null) => void;
}) {
  const scrolled = usePageScrolled();
  return (
    <div
      className={cn(
        // Out to the main column's edges, so what scrolls under it does not
        // show beside it, and below the phone's own top bar.
        // z-20, above the page's own raised bits: a table's expand chevron
        // and a row's buttons sit at z-10 over their row, and at the band's
        // own z-10 they came later in the page and were drawn over it as they
        // scrolled under.
        "sticky top-14 z-20 -ml-4 -mr-6 mb-6 bg-canvas/85 pl-4 pr-6 backdrop-blur-xl backdrop-saturate-150 md:top-0 md:-mx-6 md:px-6",
        // The main column's top padding, given back, so the band reaches the
        // top of the column when it sticks rather than stopping short of it.
        "-mt-6 pt-6 md:-mt-8 md:pt-8",
      )}
    >
      {/* The section's name, on every page in it. On its own pages it is the
          page's heading; under them (a budget, an utlägg) the page has a
          heading of its own below, so this one is not an h1 there, only the
          same words in the same place, which is where they are looked for. */}
      {own ? (
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">{section.label}</h1>
      ) : (
        <p className="mb-1 text-2xl font-semibold tracking-tight">{section.label}</p>
      )}
      {/* One row of a fixed height whatever stands at its end. 52px: the
          switch is 42 (a 32px option in a padded, bordered track) and wants
          room above and below it. */}
      <div className="flex h-13 items-stretch justify-between gap-4 border-b border-border">
        <SectionTabs label={section.tabsLabel} tabs={section.tabs} />
        <div ref={slotRef} className="flex shrink-0 items-center empty:hidden" />
      </div>
      {/* Once the page has scrolled under the band, a fade below it, so what
          slides beneath reads as going under rather than as cut off at a
          line. Not there at rest, where it would only dim the page's first
          card. The same treatment as the action bar at the foot of a form. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 top-full h-6 bg-gradient-to-b from-canvas to-transparent transition-opacity duration-200",
          scrolled ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/**
 * A page's header: what it is, and the switch for which collection of it.
 *
 * On a section's own page the band above already says what it is (the
 * section's name, and the tab), so this draws no title of its own. Under one
 * (a budget, an utlägg) it draws its back link and title as it always has.
 * Either way, in a section the switch goes up to the band's slot, so it stands
 * on the tabs' line on every page. In no section at all it is the header it
 * always was, the switch beside the title.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  right,
  aside,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: string;
  /** The collection switch or the view control, already drawn. */
  right?: React.ReactNode;
  /** The page's own controls, on the title's line. See PageShell. */
  aside?: React.ReactNode;
}) {
  const { nav, slot, reportOwn } = useContext(Ctx);
  // A page in a section with no way back is one of the section's own, the
  // ones the tabs and their switches go between, whatever its path. A path is
  // only the shell's first guess (`root`): /income/booked is not a tab's own
  // path, and it is the other half of Intäkter's switch, not a page under it.
  const own = Boolean(nav) && !back;
  useLayoutEffect(() => {
    if (!nav) return;
    reportOwn(own);
    return () => reportOwn(null);
  }, [nav, own, reportOwn]);

  if (own) {
    return (
      <>
        {right && slot && createPortal(right, slot)}
        {subtitle && <p className="-mt-3 mb-6 text-lg font-medium tracking-tight">{subtitle}</p>}
      </>
    );
  }

  // Under a section's page (a budget, an utlägg) the page keeps its own title
  // and back link, but its switch still goes up onto the tabs' line: what
  // steers the page stands at the same height whichever page it is, rather
  // than beside the title on some pages and above it on others.
  const inBand = Boolean(nav) && slot;
  // Everything on one line: the arrow back, the title, and the page's own
  // controls at the far end, with the subtitle under the title rather than
  // under the arrow. The back link on a line of its own above the title, and
  // a page's controls on a row below it, were three lines of header where one
  // will do. In a section the switch goes up to the band (above); in none it
  // stands at the far end with the controls.
  const end = !nav && right;
  return (
    <div className="mb-6 flex items-start gap-1.5">
      {inBand && right && createPortal(right, slot)}
      {back && <BackLink href={back} />}
      {/* A grid, so the order is the same however much there is. From md the
          controls stand at the end of the title's line. On a phone they have a
          row of their own under the title and the subtitle: they used to wrap
          wherever they ran out of room, a comparison picker on one line, the
          lock on the next, the menu on a third, and the subtitle under all of
          them, a long way from the title it belongs to. */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0">
          <PageTitle>{title}</PageTitle>
        </div>
        {subtitle && (
          <p className="col-start-1 row-start-2 mt-1 text-lg font-medium tracking-tight">{subtitle}</p>
        )}
        {(aside || end) && (
          <div className="col-span-2 row-start-3 mt-3 flex min-w-0 items-center justify-end gap-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0 md:flex-wrap">
            {end}
            {aside}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * PageHeader while the page is on its way, for SkeletonPage. On a section's own
 * page there is nothing to hold a place for: the band stays where it is, and
 * the switch arrives in its slot with the page.
 */
export function PageHeaderSkeleton({
  back,
  right,
  title,
  aside,
}: {
  back: boolean;
  /** Placeholders for the page's controls on the title's line. See PageHeader. */
  aside?: React.ReactNode;
  /** The placeholder for the switch, where the page has one. */
  right?: React.ReactNode;
  /** The placeholder for the page's own title, and the bar's in settings. */
  title: React.ReactNode;
}) {
  const { nav } = useContext(Ctx);
  if (nav && !back) return null;
  const end = !nav && right;
  return (
    <div className="mb-6 flex items-start gap-1.5">
      {back && <div aria-hidden className="skeleton size-8 shrink-0 rounded-control" />}
      {/* The same grid as PageHeader: controls at the end of the title's line
          from md, on a row of their own under it on a phone. */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3">
        <div className="col-start-1 row-start-1 min-w-0">{title}</div>
        {(aside || end) && (
          <div className="col-span-2 row-start-2 mt-3 flex min-w-0 items-center justify-end gap-2 md:col-span-1 md:col-start-2 md:row-start-1 md:mt-0 md:flex-wrap">
            {end}
            {aside}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The pages of a section, as tabs with the page's icon. The one you are on is
 * in bold and in the text colour, with the accent line under it.
 *
 * The line is one element under the whole row rather than a border on each
 * tab, so that moving to another tab moves it: measured to the current tab and
 * slid there with a transition. The band is not redrawn by a navigation, so
 * the line is still standing under the old tab when the new one is current.
 */
function SectionTabs({ label, tabs }: { label: string; tabs: SectionNav["tabs"] }) {
  const list = useRef<HTMLUListElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const current = tabs.findIndex((i) => i.active);
  // The tab just clicked, shown as current from the click rather than from
  // when its page arrives. The path only changes once the next page is on its
  // way, which on a slow page is a beat later, and the line used to sit still
  // under the old tab for that beat and then slide: a slide that looked as
  // slow as the page. Held only while the real current tab is still the one
  // it was clicked from, so it gives way the moment the navigation lands,
  // wherever that turns out to be.
  const [pending, setPending] = useState<{ index: number; from: number } | null>(null);
  // Forgotten as soon as the real current tab changes, so that going back to
  // the tab it was clicked from (the browser's Back) does not bring it back.
  // Set during render, React's way of resetting state when a value changes.
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setPending(null);
  }
  const active = pending && pending.from === current ? pending.index : current;
  const section = tabs.map((i) => i.href).join("|");
  // Arriving in another section, or on the first draw, the line appears in
  // place rather than sliding in from the left edge or from under a tab of
  // the last section.
  const lastSection = useRef<string | null>(null);

  useLayoutEffect(() => {
    const ul = list.current;
    const el = line.current;
    if (!ul || !el) return;
    const place = (animate: boolean) => {
      const tab = active >= 0 ? (ul.children[active] as HTMLElement | undefined) : undefined;
      el.style.opacity = tab ? "1" : "0";
      if (!tab) return;
      if (!animate) el.style.transition = "none";
      el.style.transform = `translateX(${tab.offsetLeft}px)`;
      el.style.width = `${tab.offsetWidth}px`;
      if (!animate) {
        // Painted where it is before the transition is given back, so the
        // next move slides rather than this one.
        void el.offsetWidth;
        el.style.transition = "";
      }
    };
    place(lastSection.current === section);
    lastSection.current = section;
    // Kept on its tab when the row changes size: a font arriving, a phone
    // turned on its side, the new tab's label turning bold and wider as the
    // line travels to it. Slid there too, never jumped: a new observer reports
    // the size at once, and jumping on that report is what cancelled the
    // slide the moment it began.
    const ro = new ResizeObserver(() => place(true));
    ro.observe(ul);
    return () => ro.disconnect();
  }, [section, active]);

  return (
    // `-mb-px` so the line lies over the row's divider rather than a pixel
    // above it.
    <nav aria-label={label} className="-mb-px flex min-w-0 flex-1">
      {/* Scrolls sideways on a phone rather than wrapping: four tabs of Lager
          do not fit 343px, and a second row of tabs reads as a second level. */}
      <div className="relative flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
        <ul ref={list} className="flex items-stretch gap-1">
          {tabs.map((i, n) => {
            const Icon = i.icon;
            const shown = n === active;
            return (
              <li key={i.href} className="flex shrink-0">
                <Link
                  href={i.href}
                  aria-current={i.active ? "page" : undefined}
                  onClick={(e) => {
                    // Not for a click that opens a new tab or window: this
                    // page is staying where it is.
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                    if (n !== current) setPending({ index: n, from: current });
                  }}
                  className={cn(
                    "flex items-center gap-2 border-b-2 border-transparent px-3 text-sm transition-colors",
                    shown
                      ? "font-semibold text-foreground"
                      : "font-medium text-muted hover:border-border hover:text-foreground",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {i.label}
                  {i.count > 0 && <NavCount count={i.count} />}
                </Link>
              </li>
            );
          })}
        </ul>
        <span
          ref={line}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-accent opacity-0 motion-safe:transition-[transform,width] motion-safe:duration-300 motion-safe:ease-[var(--ease-out-quint)]"
        />
      </div>
    </nav>
  );
}

/**
 * Whether the page has been scrolled at all: the main column from md up, the
 * document below it (see `data-main-scroll` in app-shell.tsx).
 */
function usePageScrolled(): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const column = document.querySelector<HTMLElement>("[data-main-scroll]");
    const read = () => setScrolled((column?.scrollTop ?? 0) > 0 || window.scrollY > 0);
    read();
    column?.addEventListener("scroll", read, { passive: true });
    window.addEventListener("scroll", read, { passive: true });
    return () => {
      column?.removeEventListener("scroll", read);
      window.removeEventListener("scroll", read);
    };
  }, []);
  return scrolled;
}
