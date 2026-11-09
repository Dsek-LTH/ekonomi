"use client";

import { cn } from "@/lib/ui/utils";
import { IconCheck } from "./icons";

/** The box as a picture, for a control that is already a button. Fill is `accent-soft` because the dark theme's accent is too pale for a foreground.
 * Empty, the edge is `faint` (3:1 against a card), not `border-border`. */
export function CheckMark({
  on,
  mixed = false,
  className,
}: {
  on: boolean;
  mixed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      // For finding the drawn box from outside (the budget sheet suppresses its focus ring).
      data-check=""
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-mark border transition-colors",
        on || mixed ? "border-accent bg-accent-soft" : "border-faint bg-background",
        className,
      )}
    >
      {mixed ? (
        <span className="h-0.5 w-2 rounded-full bg-accent" />
      ) : (
        on && <IconCheck className="size-3" />
      )}
    </span>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  indeterminate = false,
  className,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  indeterminate?: boolean;
  label: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    // `relative`: sr-only is absolute, and without a positioned ancestor focusing the input scrolls the whole document.
    <label className={cn("relative inline-flex cursor-pointer items-center", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        // Enter toggles too (natively only space): a box in a table is not in a form.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onChange();
        }}
        className="peer sr-only"
      />
      {/* The app's one focus ring (see globals.css), on the square standing in for the input. */}
      <CheckMark
        on={checked}
        mixed={indeterminate}
        className="peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--color-ring)]"
      />
      {children && <span className="ml-2.5 text-sm">{children}</span>}
    </label>
  );
}
