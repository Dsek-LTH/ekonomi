"use client";

import { cn } from "@/lib/ui/utils";

// "Which value?" The pill register, and the form-input one. Filled accent
// when active, muted when not.
//
// It used to be the one switcher for everything: page scope, list filters, view
// switches, form choices. Four questions in one shape meant a screen could ask
// two of them a hundred pixels apart and look like it was asking one twice,
// /approvals put "Mina | Alla" in the header and "Väntar | Alla" in the card
// under it, and nothing said those narrow different things. So the app has four
// switchers now, told apart by shape rather than by placement, because a shape
// is read before a label is:
//
//   (( Mina | Alla ))    CollectionSwitch: which collection the page is a list
//                        of. An enclosed track, and never rendered by a page:
//                        it is PageShell's `collections` prop, so where it sits
//                        is decided once. See components/ui/collection-switch.
//
//   ━━━━━━━━━            FilterTabs: which slice of that collection. Underlined,
//   Väntar 12  Alla      on the top edge of the card holding the rows, counts
//                        allowed. See components/ui/filter-tabs.tsx.
//
//   ☰  ▦                 ViewToggle: how the same rows are drawn. Icons only,
//                        right-aligned above what it redraws.
//
//   ( Zettle | Swish )   this: a value being chosen in a form. Always inside a
//                        labelled Field or FieldGroup, which is what makes it
//                        read as a radio group rather than as navigation: the
//                        ledger's report kind, the fetch panel's source, the
//                        budget change's kind.
//
// So: a pill row that is not inside a Field is one of the other three wearing
// the wrong clothes.
interface SegOption<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  className,
  size = "md",
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("flex flex-wrap gap-1", className)} role="tablist">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors",
              size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm",
              active
                ? "brand-fill text-on-brand"
                : "text-muted hover:bg-hover hover:text-foreground",
            )}
          >
            {opt.label}
            {opt.badge != null && opt.badge > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs tabular-nums",
                  // On the pink pill the badge darkens rather than lightens,
                  // a white wash on this fill is nearly invisible.
                  active
                    ? "bg-on-brand/15 text-on-brand"
                    : "bg-accent-soft text-accent",
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
