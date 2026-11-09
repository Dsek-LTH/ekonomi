"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";

import { cn } from "@/lib/ui/utils";

// Measures before paint so the pill is in place on first frame. useLayoutEffect is a warned no-op on the server.
const useMeasureEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface CollectionOption {
  value: string;
  label: string;
  count?: number;
}

export type Collections = {
  label: string;
  value: string;
  options: CollectionOption[];
} & (
  | { href: (value: string) => string; onChange?: never }
  | { onChange: (value: string) => void; href?: never }
);

// `relative`: the pill is laid over the track. On a phone the options share the leftover width (flex-auto) so "Min resultatenhet" stays on one line.
const TRACK =
  "relative inline-flex rounded-control border border-border-control bg-surface p-0.5 max-md:flex max-md:w-full";

// Corners are the track's less the 3px it sits inside (border plus padding), so the curves run parallel.
const PILL = "rounded-mark action-fill";

const Count = ({ count }: { count?: number }) =>
  count ? <span className="ml-1.5 tabular-nums opacity-70">{count}</span> : null;

/** Where the active option is in the track's coordinates. `animate` is off for the first placement, so the pill does not slide in from the corner. */
type Placement = { x: number; y: number; w: number; h: number; animate: boolean };

export function CollectionSwitch({ label, value, options, href, onChange }: Collections) {
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const activeIndex = options.findIndex((o) => o.value === value);
  // Watches labels and counts, not `options` (a fresh array every render).
  const shape = options.map((o) => `${o.value}:${o.label}:${o.count ?? ""}`).join("|");

  useMeasureEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (!el) {
      setPlacement(null);
      return;
    }
    // Measured from the track's padding edge (minus clientLeft), with bounding rects: offsetLeft/offsetWidth round to whole pixels.
    const measure = () => {
      const track = el.parentElement;
      if (!track) return;
      const r = el.getBoundingClientRect();
      const t = track.getBoundingClientRect();
      setPlacement((prev) => ({
        x: r.left - t.left - track.clientLeft,
        y: r.top - t.top - track.clientTop,
        w: r.width,
        h: r.height,
        animate: prev !== null,
      }));
    };
    measure();
    // Widths change without a re-render (webfont landing, a count going 9 to 10 to the left), so the track is observed too.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [activeIndex, shape]);

  const item = (active: boolean) =>
    cn(
      // Above the pill, which would otherwise paint over the label.
      "relative flex h-[26px] items-center rounded-mark px-3 text-sm font-medium transition-colors max-md:flex-auto max-md:justify-center max-md:whitespace-nowrap",
      active
        ? cn(
            "text-white",
            // Same shape drawn statically until the pill is measured, so SSR and hydration match.
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
        // `transform` and `width` together: options differ in width. Reduced motion is handled by globals.css.
        placement?.animate && "transition-[transform,width] duration-200 ease-out",
      )}
    />
  );

  const collect = (i: number) => (el: HTMLElement | null) => {
    itemRefs.current[i] = el;
  };

  // Real hrefs, so links can be opened in a new tab and prefetched.
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
            data-tour={`scope:${o.value}`}
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
          onClick={() => onChange(o.value)}
          data-tour={`scope:${o.value}`}
          className={item(o.value === value)}
        >
          {o.label}
          <Count count={o.count} />
        </button>
      ))}
    </div>
  );
}
