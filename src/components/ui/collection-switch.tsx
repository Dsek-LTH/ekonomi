"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/ui/utils";

// The pill has to be in place in the frame the track first paints, or the
// active option sits bare for a frame after every hydration. That means
// measuring before paint, but on the server `useLayoutEffect` is a no-op React
// warns about, and this component renders there too.
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// "Which collection am I looking at?" The track register, and the app's
// answer to that question everywhere it is asked.
//
// See components/ui/segmented-control.tsx for the grammar the switchers share.
// This is the coarsest of them: it changes *what* the page is a list of, and
// the page's own title stays put while it does. The track is what says which
// one you are on, so a heading that said it again would be saying it twice.
//
// Two ways of switching, one appearance. "Mina | Alla" is a query parameter on
// one page; "Att bokföra | Bokförda" is two pages. That difference matters to
// the router and to nobody else, so the caller declares `onChange` or `href`
// and gets the same control either way, which is the whole point, because the
// two used to look like different kinds of thing.
//
// Never rendered directly by a page: it is `PageShell`'s `collections` prop, so
// that where it sits is decided once rather than per screen.
export interface CollectionOption {
  value: string;
  label: string;
  /** Shown muted after the label, e.g. "Att bokföra 12". */
  count?: number;
}

export type Collections = {
  /** Names the group for a screen reader: "Omfattning", "Avsnitt". */
  label: string;
  /** Which option is current. */
  value: string;
  options: CollectionOption[];
} & (
  // One or the other, never both and never a mixture. Declared at the group
  // rather than per option so a set cannot be half links and half buttons,
  // that would be two controls wearing one appearance, which is the thing this
  // component exists to stop.
  | { href: (value: string) => string; onChange?: never }
  | { onChange: (value: string) => void; href?: never }
);

// `relative`, because the pill is laid over the track rather than drawn on the
// option. See the measurement below.
const TRACK = "relative inline-flex rounded-control border border-border bg-surface p-1";

// What the pill looks like, in the one place both the moving copy and the
// static fallback read it from.
//
// --shadow-pill, not --shadow-card: the pill is the height of the track's
// content box, so it is centred by construction. But a shadow that leans
// downwards puts more darkness in the 4px below it than above, and the eye
// reads that as the pill sitting low. See globals.css.
const PILL = "rounded-mark bg-background shadow-[var(--shadow-pill)]";

const Count = ({ count }: { count?: number }) =>
  count ? <span className="ml-1.5 tabular-nums text-muted">{count}</span> : null;

/**
 * Where the active option is, in the track's own coordinates, and whether the
 * pill should travel to get there.
 *
 * `animate` is derived from whether there was a previous placement, so the
 * first one is a position and every one after it is a move. Both live in the
 * same state on purpose: set apart, the first placement would land in a commit
 * that already had the transition on it, and the pill would open the page by
 * sliding in from the corner.
 */
type Placement = { x: number; y: number; w: number; h: number; animate: boolean };

export function CollectionSwitch({ label, value, options, href, onChange }: Collections) {
  // The pill used to be a background on whichever option was active, so
  // switching swapped it from one to the other and it simply reappeared in a
  // different place. As one element laid over the track it travels instead,
  // which is what says the two options are two positions of one control rather
  // than two controls that happen to sit together.
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const activeIndex = options.findIndex((o) => o.value === value);
  // The labels and counts are what decide the pill's width, so they are what a
  // re-measure watches, not `options`, which is a fresh array every render and
  // would re-run this effect on all of them.
  const shape = options.map((o) => `${o.value}:${o.label}:${o.count ?? ""}`).join("|");

  useMeasureEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) {
      setPlacement(null);
      return;
    }
    // offsetLeft/offsetTop are measured from the offsetParent's padding edge,
    // and `left: 0` on an absolutely positioned child resolves to that same
    // edge, so the two agree without anyone having to subtract the track's
    // own border.
    const measure = () =>
      setPlacement((prev) => ({
        x: el.offsetLeft,
        y: el.offsetTop,
        w: el.offsetWidth,
        h: el.offsetHeight,
        animate: prev !== null,
      }));
    measure();
    // Widths move without this component re-rendering: a webfont landing after
    // first paint, or a count going from 9 to 10 in an option to the left of
    // the active one, which shifts it without changing its size. The track is
    // observed as well as the option for that second case.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [activeIndex, shape]);

  const item = (active: boolean) =>
    cn(
      // Above the pill, which is a positioned sibling and would otherwise paint
      // over the label.
      "relative rounded-mark px-4 py-1.5 text-sm font-medium transition-colors",
      active
        ? cn(
            "text-foreground",
            // Until the pill has been measured there is nothing laid over the
            // track, and this is the same shape drawn the old way. It is what
            // the server renders and what the first client render matches, so
            // the switch to the real pill one commit later changes no pixels,
            // without it the active option would arrive from the server with no
            // background at all and gain one on hydration.
            !placement && PILL,
          )
        : "text-muted hover:text-foreground",
    );

  const pill = (
    <span
      aria-hidden
      style={
        placement
          ? {
              transform: `translate3d(${placement.x}px, ${placement.y}px, 0)`,
              width: placement.w,
              height: placement.h,
            }
          : undefined
      }
      className={cn(
        "pointer-events-none absolute left-0 top-0",
        PILL,
        !placement && "opacity-0",
        // `transform` and `width` together: the two options are rarely the same
        // width, so a pill that only slid would snap to its new width at one
        // end of the journey.
        //
        // Reduced motion needs nothing here. globals.css cuts every duration
        // in the app to 0.01ms, so the pill arrives instead of travelling.
        placement?.animate && "transition-[transform,width] duration-200 ease-out",
      )}
    />
  );

  const collect = (i: number) => (el: HTMLElement | null) => {
    itemRefs.current[i] = el;
  };

  // Links when the collections are pages. A <nav> with real hrefs, so they can
  // be opened in a new tab, prefetched and restored on a reload, none of which
  // a button pretending to navigate can do.
  if (href) {
    return (
      <nav aria-label={label} className={TRACK}>
        {pill}
        {options.map((o, i) => (
          <Link
            key={o.value}
            ref={collect(i)}
            href={href(o.value)}
            aria-current={o.value === value ? "page" : undefined}
            className={item(o.value === value)}
          >
            {o.label}
            <Count count={o.count} />
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" aria-label={label} className={TRACK}>
      {pill}
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={collect(i)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange?.(o.value)}
          className={item(o.value === value)}
        >
          {o.label}
          <Count count={o.count} />
        </button>
      ))}
    </div>
  );
}
