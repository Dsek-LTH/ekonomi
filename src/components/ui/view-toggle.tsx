"use client";

import { cn } from "@/lib/ui/utils";
import { PlainButton } from "./button";

// Icons and no words, deliberately: a view switch does not change what you are looking at. See segmented-control.tsx.
interface ViewOption<T extends string> {
  value: T;
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
}

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  className,
  labels = false,
  "aria-label": ariaLabel,
}: {
  options: ViewOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  labels?: boolean;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-control border border-border-control bg-surface p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <PlainButton
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={labels ? undefined : opt.label}
            title={labels ? undefined : opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex items-center justify-center rounded-mark transition-colors",
              // 26px inside the track's border and padding: 32px in all, the height of a field or button beside it.
              labels ? "h-[26px] gap-1.5 px-2.5 text-sm font-medium" : "size-[26px]",
              active
                ? // The selected pill in a track, as in CollectionSwitch.
                  "bg-background text-foreground shadow-[var(--shadow-pill)]"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {labels && opt.label}
          </PlainButton>
        );
      })}
    </div>
  );
}
