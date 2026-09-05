"use client";

import { cn } from "@/lib/ui/utils";

// "How are these drawn?" The icon register. See segmented-control.tsx for
// the grammar the four switchers share.
//
// Icons and no words, deliberately. A view switch is the only one of them
// that does not change *what* you are looking at, and a wordless control cannot
// be misread as naming a collection or a slice. It is also the only one whose
// options are pictures of themselves: a split view looks like a split view.
//
// Right-aligned, on the strip immediately above what it redraws.
interface ViewOption<T extends string> {
  value: T;
  /** What it does, for the tooltip and the screen reader. There is no label. */
  label: string;
  icon: (props: { className?: string }) => React.ReactNode;
}

export function ViewToggle<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  options: ViewOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            // The name a screen reader reads, and the one the pointer gets on
            // hover, without it this is two unlabelled buttons.
            aria-label={opt.label}
            title={opt.label}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex size-7 items-center justify-center rounded-md transition-colors",
              active
                // The selected pill in a track, same reasoning, and the same
                // token, as CollectionSwitch. The gutter here is 2px, so a
                // shadow that leans down has even less room to do it in.
                ? "bg-background text-foreground shadow-[var(--shadow-pill)]"
                : "text-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
