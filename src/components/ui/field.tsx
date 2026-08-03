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
type Size = "sm" | "md";
const SIZES: Record<Size, string> = {
  sm: "h-9 rounded-lg px-2.5",
  md: "rounded-xl px-3.5 py-2.5",
};
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
      {/* What's wrong with what's typed replaces the standing hint — two lines
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
// the first labelable element inside it — and <button> is labelable — so
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
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & { size?: Size }) {
  return <input className={control(size, className)} {...props} />;
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
