"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/ui/utils";

// "Which slice of this list?" The underline register.
//
// One of three switchers, and the app tells them apart by *shape* rather than by
// where they happen to sit, because a shape is read before a label is:
//
//   (( Mina | Alla ))    CollectionSwitch: which collection the page is a list
//                        of. An enclosed track, placed by PageShell.
//
//   ━━━━━━━━━            FilterTabs: which slice of that collection. Underlined,
//   Väntar 12  Alla      on the top edge of the card holding the rows.
//
//   ☰  ▦                 ViewToggle: how the same rows are drawn. Icons only.
//
//   ( Zettle | Swish )   SegmentedControl: a value chosen in a form, always
//                        inside a labelled Field.
//
// Underlines for this one because that is what tabs have always meant: sections
// of the thing directly below them. The rows change, the collection does not,
// which is exactly the difference from the pills above, where the collection is
// what changes and the page title changes with it.
//
// The count belongs here and not on the pills, for the same reason: "12 waiting"
// is a fact about a slice of a list you are already looking at.
interface FilterTab<T extends string> {
  value: T;
  label: string;
  /** Shown after the label when there is something in that slice. */
  badge?: number;
  /** The badge is work waiting on the reader, so it is pink like the count on
   *  the section's tab (shell/nav-count.tsx) rather than a grey tally. */
  waiting?: boolean;
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  fill = false,
  className,
  "aria-label": ariaLabel,
}: {
  options: FilterTab<T>[];
  value: T;
  onChange: (value: T) => void;
  /**
   * Whether the tabs divide the width up equally between them.
   *
   * Off by default. A filter bar's tabs are a list of slices and read as one
   * phrase, "Väntar 12   Alla", and stretching two of them across a desktop
   * card would put an inch of nothing between a label and the end of its own
   * underline.
   *
   * On for a switcher that *is* the row it stands in: the event sheet's
   * three columns on a phone. There the tabs are the only thing on the line
   * and an equal third each is what makes them read as one control being
   * turned rather than as three words in the corner.
   */
  fill?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  // The underline is one line that travels between the tabs rather than a
  // border each tab turns on, the same as the section tabs over the page
  // (shell/section-nav.tsx), so moving from one slice to the next is seen as
  // a move. Placed without a slide on the first draw, so it does not come in
  // from the left edge.
  const bar = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const index = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const row = bar.current;
    const el = line.current;
    if (!row || !el) return;
    const place = (animate: boolean) => {
      const tab = index >= 0 ? (row.children[index] as HTMLElement | undefined) : undefined;
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
    place(placed.current);
    placed.current = true;
    // Kept on its tab when the row changes size: a font arriving, a badge
    // count changing the tab's width.
    const ro = new ResizeObserver(() => place(true));
    ro.observe(row);
    return () => ro.disconnect();
  }, [index]);

  return (
    // Scrolls rather than wraps: a wrapped second row of tabs reads as a second
    // question, which is the confusion this whole register exists to remove.
    // -mb-px puts the active tab's underline *on* the container's own bottom
    // border rather than a hair above it.
    //
    // One gap or the other, never both: `cn` joins rather than merges, so two
    // `gap-` utilities would be settled by stylesheet order instead of intent.
    <div
      ref={bar}
      role="tablist"
      aria-label={ariaLabel}
      className={cn("relative -mb-px flex overflow-x-auto", fill ? "gap-2" : "gap-5", className)}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 pb-2.5 pt-2 text-sm font-medium transition-colors",
              // Filling, a tab is a share of the row and its label sits in the
              // middle of that share; otherwise it is exactly as wide as what
              // it says and never squeezed by a neighbour.
              fill ? "flex-1 justify-center" : "shrink-0",
              active
                ? "border-transparent text-foreground"
                : "border-transparent text-muted hover:border-border hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.badge != null && opt.badge > 0 && (
              <span
                className={cn(
                  "rounded-mark px-1.5 py-0.5 text-xs tabular-nums",
                  opt.waiting
                    ? "action-fill text-white"
                    : active
                      ? "bg-action-from/20 text-foreground"
                      : "bg-surface text-muted",
                )}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
      {/* Last, so it is not one of the tabs `children[index]` counts. */}
      <span
        ref={line}
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-linear-to-r from-action-from to-action-to opacity-0 motion-safe:transition-[transform,width] motion-safe:duration-300 motion-safe:ease-[var(--ease-out-quint)]"
      />
    </div>
  );
}
