"use client";

import { cn } from "@/lib/ui/utils";
import { DateInput as DateInputBase } from "./date-input";

// No focus styling here: the app draws one ring for everything from
// globals.css, and utilities can't override it anyway. This used to add an
// accent border and a soft halo on top of that ring, which is where the "two
// outlines, and one of them only on click" came from.
const CONTROL =
  "w-full border border-border bg-background text-sm text-foreground placeholder:text-muted/60 transition-[color,background-color] duration-150 disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed";

// "md" is the form control; "sm" is the compact one that sits in a card header,
// a filter bar or a table row. Sizes live here so those don't get re-typed.
//
// Exported because the combobox is one of these controls and used to carry its
// own copy of the compact one, so a combobox beside a date input was six
// pixels shorter than it and a different corner radius, in every form in the
// app. Sharing the strings is what makes "the same size" true rather than
// approximately true.
export type ControlSize = "sm" | "md";
type Size = ControlSize;
// "sm" is two heights, not one. 36px is a density for a pointer, and it is what
// every filter bar in the app was built at. On a phone that is a control you
// aim at rather than one you hit, eight pixels under what both Apple and
// Google ask for. So below sm it stands at 44 and from sm up it goes back to
// the density a mouse earns.
//
// One height per band written into the same string, rather than left to call
// sites: a toolbar is five of these in a row and any one of them opting out
// would be the row that no longer lines up.
export const CONTROL_SIZES: Record<ControlSize, string> = {
  sm: "h-11 rounded-lg px-2.5 sm:h-9",
  // No height of its own: md is sized by its padding, which puts it at 42px,
  // near enough to the 44 a finger wants that forcing it would only make every
  // form on a phone taller. The textarea shares this string and has no business
  // being 44px tall either.
  md: "rounded-xl px-3.5 py-2.5",
};
const SIZES = CONTROL_SIZES;
const control = (size: Size, className?: string) => cn(CONTROL, SIZES[size], className);

function fieldContent(
  label: string,
  children: React.ReactNode,
  hint?: string,
  error?: string,
) {
  return (
    <>
      <span className="mb-1.5 block text-[13px] font-medium text-foreground">
        {label}
      </span>
      {children}
      {/* What's wrong with what's typed replaces the standing hint. Two lines
          of small text under one control read as one sentence and neither
          lands. Same warning colour as the submit blocker on the last step. */}
      {error ? (
        <span className="mt-1 block text-xs text-warning">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
    </>
  );
}

// A label for ONE native control (Input, Textarea, Select, DateInput). It's a
// real <label>, so clicking the text focuses the control.
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  /** Shown in place of `hint` while what's typed isn't accepted. */
  error?: string;
  children: React.ReactNode;
}) {
  return <label className="block">{fieldContent(label, children, hint, error)}</label>;
}

// A label for a composite: a picker, a row of choice buttons, a whole sub-editor.
//
// Deliberately not a <label>. A <label> forwards a click anywhere in its box to
// the first labelable element inside it, and <button> is labelable, so
// wrapping a Combobox (whose trigger is a button) meant clicking the empty space
// beside or below it popped the menu open. Here the label only labels.
export function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="block">
      {fieldContent(label, children, hint)}
    </div>
  );
}

export function Input({
  className,
  size = "md",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: Size;
  // React 19 passes `ref` as an ordinary prop, so this needs declaring and
  // nothing else. A screen that moves focus for you (the stock register hands
  // it back and forth between a product and a count for a whole pallet) has to
  // be able to reach the element.
  ref?: React.Ref<HTMLInputElement>;
}) {
  return <input className={control(size, className)} {...props} />;
}

/**
 * An input with something fastened to the end of it, inside the same border: a
 * unit, or a button that fills the field in for you.
 *
 * Extracted from the strength field, which drew the box, the bare input and the
 * "%" by hand, and then the barcode field wanted the same shape for its
 * scanner, which had been sitting *beside* the input as a separate control. Two
 * boxes in a row read as two things to fill in; one box with a button in the
 * corner reads as one field with a shortcut, which is what it is.
 *
 * The ring goes round the pair rather than round the input: `focus-ring-within`
 * draws it on the box and suppresses the input's own (see globals.css), so
 * focusing the text does not outline half a field.
 *
 * `className` dresses the box, because the box is what the control looks like.
 * a suffix that is a button wants `pr-1` there so it can sit near the edge.
 * `inputClassName` is for the text itself (`tabular-nums`, an alignment).
 *
 * No disabled styling: CONTROL's `disabled:` rules key off the input, and here
 * the input is not the element carrying them. Nothing needs it yet; a field
 * that does should grow it here rather than around it.
 */
export function SuffixedInput({
  suffix,
  size = "md",
  className,
  inputClassName,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  suffix: React.ReactNode;
  size?: Size;
  className?: string;
  inputClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className={cn("focus-ring-within flex items-center gap-1.5", control(size), className)}>
      {/* w-0 with a floor, not `w-full`: a flex child sized by its content
          refuses to shrink past it, and a long barcode would push the suffix
          out of the box rather than scroll under it. */}
      <input
        {...props}
        className={cn(
          // CONTROL's own placeholder rule is on the box, where `::placeholder`
          // matches nothing, so it is restated on the element that has one.
          "w-0 min-w-[4ch] flex-1 bg-transparent placeholder:text-muted/60",
          inputClassName,
        )}
      />
      {suffix}
    </div>
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={control("md", cn("min-h-24 resize-y", className))} {...props} />;
}

export function DateInput({
  className,
  size = "md",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & { size?: Size }) {
  return <DateInputBase className={control(size, className)} {...props} />;
}

export function Select({
  className,
  size = "md",
  children,
  ...props
}: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> & { size?: Size }) {
  return (
    <select className={control(size, cn("appearance-none pr-9", className))} {...props}>
      {children}
    </select>
  );
}
