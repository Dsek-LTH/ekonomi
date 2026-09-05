"use client";

import { useId } from "react";

import { cn } from "@/lib/ui/utils";
import { CONTROL_SIZES } from "./field";
import { IconSearch } from "./icons";

// A text field with the search glyph inside it. Used by the table filter bar and
// every "search as you type" picker, so the affordance looks the same in all of
// them. `className` sizes the wrapper; the input always fills it.
export function SearchInput({
  className,
  inputClassName,
  id,
  ...props
}: {
  className?: string;
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  // Every form field wants an id, whether or not anything points at it: a
  // browser will not autofill one that has neither id nor name, and says so in
  // the console. Overridable, for a caller that has already named it.
  const autoId = useId();
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted/60" />
      <input
        id={id ?? autoId}
        type="search"
        // Measured from the shared table rather than from a copy of it: this
        // sits in the same toolbar as a combobox and a date input, and it used
        // to carry its own `h-9`, which is exactly how a row ends up a few
        // pixels out of true the day that table changes. `pl-8` for the glyph
        // and `pr-2.5` land after the table's `px-2.5` in Tailwind's own order,
        // so they win without `cn` having to merge anything.
        className={cn(
          CONTROL_SIZES.sm,
          "w-full border border-border bg-background pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted/60",
          inputClassName,
        )}
        {...props}
      />
    </div>
  );
}
