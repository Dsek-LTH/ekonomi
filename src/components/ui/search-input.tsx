"use client";

import { cn } from "@/lib/ui/utils";
import { IconSearch } from "./icons";

// A text field with the search glyph inside it. Used by the table filter bar and
// every "search as you type" picker, so the affordance looks the same in all of
// them. `className` sizes the wrapper; the input always fills it.
export function SearchInput({
  className,
  inputClassName,
  ...props
}: {
  className?: string;
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted/60" />
      <input
        type="search"
        className={cn(
          "h-9 w-full rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted/60",
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}
