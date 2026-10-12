"use client";

// The app's tick box, in the two forms anything needs it.
//
// It came from the multi-select picker's option rows (components/ui/combobox),
// which drew its own rather than a native box for a plain reason: a native
// checkbox is the operating system's, and next to a list of the app's own
// fields it looks like a piece of another program. Once the budget sheet wanted
// boxes down its margin, the drawing was worth having in one place instead of
// two, the same square, the same accent, whichever side of the app you meet it
// on.
import { cn } from "@/lib/ui/utils";
import { IconCheck } from "./icons";

/**
 * The box as a picture: no input, no behaviour, for a control that is already a
 * button and only needs to show its state (an option row in a picker).
 *
 * The fill is `accent-soft`, not `accent`: the dark theme's accent is a pale
 * pink that no foreground sits on legibly.
 *
 * Empty, the box is edged in `faint` and filled with the card's own white. It
 * was `border-border`, which is 1.2:1 against a card and the same grey as the
 * hover fill a picker row takes, so on the row under the pointer the box all
 * but disappeared. A box's edge is what says there is a box at all, so it owes
 * the 3:1 that `faint` is for, and the fill keeps it a box on a tinted row.
 */
export function CheckMark({
  on,
  mixed = false,
  className,
}: {
  on: boolean;
  /** Some of a set ticked: drawn as a dash rather than as either state. */
  mixed?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      // For anything that needs to find the drawn box from outside, the budget
      // sheet suppresses its focus ring, since a cell there is already outlined
      // as a whole and two lines around one thing reads as two things.
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

/**
 * The box as a control: a real checkbox, drawn as the mark above.
 *
 * The input itself is there and focusable. It is what a keyboard tabs to and
 * toggles with space, and what a screen reader reads, but it is not what you
 * see; `peer` carries its focus to the square that stands in for it.
 */
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
  /**
   * A select-all box over a list that is partly ticked. Half a selection is
   * neither state the box has, and the dash is what says so. Set on the input
   * too, so a screen reader announces it as mixed.
   */
  indeterminate?: boolean;
  /** The accessible name. There is no visible one. These sit in a margin. */
  label: string;
  className?: string;
  /**
   * Visible text beside the box, for a box that stands in a list of options
   * rather than in a margin. Inside the same <label>, so the words are part of
   * what you click, and the box keeps `label` as its name.
   */
  children?: React.ReactNode;
}) {
  return (
    // `relative`, so the input below is positioned against this label.
    // `sr-only` is `position: absolute`, and with no positioned ancestor its
    // containing block is the page itself, so it is not clipped by the frame's
    // scroll container (`md:overflow-y-auto` in components/shell/app-shell) and
    // sits wherever it happens to land in *document* coordinates. On a wide
    // screen, where the frame is `h-screen` and must not scroll, that made the
    // document scrollable; clicking a box focuses the input, the browser scrolls
    // the document to reveal it, and the whole app slides off the top leaving an
    // empty page behind. The roles grid is where it showed, eighty-four of
    // these, two thousand pixels down, but the box was wrong, not the grid.
    <label className={cn("relative inline-flex cursor-pointer items-center", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        ref={(el) => {
          if (el) el.indeterminate = indeterminate;
        }}
        // Enter as well as space. A checkbox answers only to space natively.
        // Enter belongs to the form it is in, but a box in a table is not in a
        // form, it is one of a column of things being ticked, and Enter is what
        // a hand on the keyboard reaches for.
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          onChange();
        }}
        className="peer sr-only"
      />
      {/* The app's one focus ring, on the square standing in for the input:
          1px just off the edge, as everything else focusable wears it. See
          globals.css. A Tailwind `ring-*` would be a second, thicker idiom. */}
      <CheckMark
        on={checked}
        mixed={indeterminate}
        className="peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-[var(--color-ring)]"
      />
      {children && <span className="ml-2.5 text-sm">{children}</span>}
    </label>
  );
}
