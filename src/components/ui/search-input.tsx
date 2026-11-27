"use client";

import { useId } from "react";

import { cn } from "@/lib/ui/utils";
import { CONTROL_SIZES } from "./field";
import { IconSearch } from "./icons";

export function SearchInput({
  className,
  inputClassName,
  action,
  id,
  ...props
}: {
  className?: string;
  inputClassName?: string;
  /** A FieldAction at the field's end, inside its border (the scanner beside a product search). */
  action?: React.ReactNode;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "className">) {
  // Every field gets an id: a browser will not autofill one with neither id nor name.
  const autoId = useId();
  return (
    <div className={cn("relative", className)}>
      <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
      <input
        id={id ?? autoId}
        type="search"
        // `pl-8` for the glyph and `pr-2.5` land after the shared table's `px-2.5` in Tailwind's order, so they win.
        className={cn(
          CONTROL_SIZES.sm,
          "w-full border border-border-control bg-background pl-8 pr-2.5 text-sm text-foreground placeholder:text-muted",
          // A long hint ends in an ellipsis on a phone rather than being cut through a word.
          "max-md:text-ellipsis",
          // Room for the action: its 32px (24px from sm) and the gap to the border.
          action ? "pr-11 sm:pr-9" : undefined,
          inputClassName,
        )}
        {...props}
      />
      {action && (
        // Where SuffixedInput puts it: its border and 10px padding (11px from the outside), less FieldAction's 6px pull.
        <div className="absolute inset-y-0 right-[11px] flex items-center">{action}</div>
      )}
    </div>
  );
}
