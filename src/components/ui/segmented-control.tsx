"use client";

import { cn } from "@/lib/ui/utils";

// The pill register for a value chosen in a form: always inside a labelled Field or FieldGroup.
// Page scope is CollectionSwitch, slices are FilterTabs, view modes are ViewToggle: a pill row outside a Field is one of those wearing the wrong clothes.
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
              "inline-flex items-center gap-1.5 rounded-control font-medium transition-colors",
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
                  "rounded-mark px-1.5 py-0.5 text-xs tabular-nums",
                  // On the pink pill the badge darkens: a white wash on this fill is nearly invisible.
                  active ? "bg-on-brand/15 text-on-brand" : "bg-accent-soft text-accent",
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
