"use client";

import { useLayoutEffect, useRef } from "react";
import { useScrollStrip } from "@/lib/ui/scroll-strip";
import { cn } from "@/lib/ui/utils";

// The underline register: which slice of the collection. Counts belong here, not on the collection pills.
interface FilterTab<T extends string> {
  value: T;
  label: string;
  badge?: number;
  /** Work waiting on the reader: pink like the nav count (shell/nav-count.tsx), not a grey tally. */
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
  /** Divide the width equally. Off by default (a filter bar's tabs read as one phrase); on for a switcher that is the whole row. */
  fill?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  // One underline that travels between tabs (as in shell/section-nav.tsx); placed without a slide on first draw.
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
        // Painted in place before the transition is given back.
        void el.offsetWidth;
        el.style.transition = "";
      }
    };
    place(placed.current);
    placed.current = true;
    // Kept on its tab when the row changes size (a font arriving, a count changing).
    const ro = new ResizeObserver(() => place(true));
    ro.observe(row);
    return () => ro.disconnect();
  }, [index]);

  useScrollStrip(bar, index);

  return (
    // Scrolls rather than wraps (a second row reads as a second question). On a phone the side with more fades out and the active tab is kept in view (useScrollStrip).
    // -mb-px puts the active underline on the container's bottom border. One gap or the other: cn joins rather than merges.
    <div
      ref={bar}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "scroll-strip relative -mb-px flex overflow-x-auto",
        fill ? "gap-2" : "gap-5 max-md:gap-3",
        className,
      )}
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
            data-tour={`tab:${opt.value}`}
            className={cn(
              "inline-flex items-center gap-1.5 border-b-2 pb-2.5 pt-2 text-sm font-medium transition-colors",
              // Filling, a tab is a share of the row; otherwise exactly as wide as its text.
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
