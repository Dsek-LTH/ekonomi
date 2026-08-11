"use client";

import { cn } from "@/lib/ui/utils";

// "Which slice of this list?" — the underline register.
//
// One of three switchers, and the app tells them apart by *shape* rather than by
// where they happen to sit, because a shape is read before a label is:
//
//   (( Mina | Alla ))    CollectionSwitch — which collection the page is a list
//                        of. An enclosed track, placed by PageShell.
//
//   ━━━━━━━━━            FilterTabs — which slice of that collection. Underlined,
//   Väntar 12  Alla      on the top edge of the card holding the rows.
//
//   ☰  ▦                 ViewToggle — how the same rows are drawn. Icons only.
//
//   ( Zettle | Swish )   SegmentedControl — a value chosen in a form, always
//                        inside a labelled Field.
//
// Underlines for this one because that is what tabs have always meant: sections
// of the thing directly below them. The rows change, the collection does not —
// which is exactly the difference from the pills above, where the collection is
// what changes and the page title changes with it.
//
// The count belongs here and not on the pills, for the same reason: "12 waiting"
// is a fact about a slice of a list you are already looking at.
export interface FilterTab<T extends string> {
  value: T;
  label: string;
  /** Shown after the label when there is something in that slice. */
  badge?: number;
}

export function FilterTabs<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: FilterTab<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    // Scrolls rather than wraps: a wrapped second row of tabs reads as a second
    // question, which is the confusion this whole register exists to remove.
    // -mb-px puts the active tab's underline *on* the container's own bottom
    // border rather than a hair above it.
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("-mb-px flex gap-5 overflow-x-auto", className)}
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
              "inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2.5 pt-2 text-sm font-medium transition-colors",
              active
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:border-border hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.badge != null && opt.badge > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                  active ? "bg-accent-soft text-accent" : "bg-surface text-muted",
                )}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
