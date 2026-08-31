"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/ui/utils";

// A value that is an input the whole time, dressed as plain text until you go
// near it: transparent and borderless at rest, gaining a surface on hover and a
// border and caret on focus. Click and type. There is no mode to enter, and so
// no pencil to find and no moment where the thing under the pointer changes
// into a different thing.
//
// Enter commits, Escape puts back what was there, and clicking away commits
// too: leaving a field is how every other cell in this app is finished, and
// silently discarding what someone typed is the worse surprise.
//
// The text inherits the surrounding type, so the same component is a page title
// in one place and a table cell in another. Width comes from the content (see
// the sizer below) rather than from the call site, which is what keeps it
// reading as a word in a sentence instead of as a form field parked in one.

// Shared by the input and its sizer. Every property that affects text metrics
// has to be identical on both or the box will not match what is typed in it,
// so they are written once here rather than kept in step by hand.
const METRICS = "px-1.5 py-0.5 text-[length:inherit] font-[inherit] leading-[inherit] tracking-[inherit]";

export function EditableText({
  value,
  onSave,
  label,
  type = "text",
  placeholder,
  disabled,
  className,
  inputClassName,
}: {
  value: string;
  /**
   * Commit. Return `false` to reject the value and keep the caret in the field,
   * the caller owns validation, since only it knows what a valid year or name
   * is.
   */
  onSave: (value: string) => boolean | void | Promise<boolean | void>;
  /** Names the input, so it is reachable by voice and screen reader. */
  label: string;
  /** "date" gives the browser's own date picker and commits a YYYY-MM-DD. */
  type?: "text" | "number" | "date";
  placeholder?: string;
  /** Read-only: the plain text, with no input behind it at all. */
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape blurs the input, and the blur would otherwise commit the very edit
  // that was just abandoned.
  const abandoned = useRef(false);

  // Adopt a value that changed underneath us (a save landing, a router
  // refresh, another tab) but never while the field has focus, where it would
  // overwrite what someone is in the middle of typing.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value);
  }, [value]);

  async function commit() {
    if (abandoned.current || saving) return;
    if (draft === value) return; // nothing to write
    setSaving(true);
    const ok = await onSave(draft);
    setSaving(false);
    // Rejected: the caller has said why, and the value is still wrong, so the
    // caret goes back where it can be fixed. Accepted: the new `value` arrives
    // as a prop and the effect above syncs the draft to it.
    if (ok === false) inputRef.current?.focus();
  }

  // No input at all when it cannot be edited, rather than a disabled one: a
  // reader tabbing through the page should not stop on a field that will never
  // take anything, and a greyed-out box reads as something broken rather than
  // as something that was never theirs.
  if (disabled) {
    return (
      <span className={className}>
        {value || <span className="text-muted">{placeholder}</span>}
      </span>
    );
  }

  // A date input is sized by the browser around its own picker, so measuring
  // the text would fight it. Everything else is sized by the sizer span below.
  const autoSize = type !== "date";

  const input = (
    <input
      ref={inputRef}
      value={draft}
      type={type}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => { abandoned.current = false; }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); inputRef.current?.blur(); }
        if (e.key === "Escape") {
          abandoned.current = true;
          setDraft(value);
          inputRef.current?.blur();
        }
      }}
      placeholder={placeholder}
      aria-label={label}
      className={cn(
        METRICS,
        // Text at rest. The border is transparent rather than absent so that
        // gaining one on hover does not move the text by a pixel.
        "rounded-md border border-transparent bg-transparent text-inherit",
        "placeholder:text-muted/60 transition-colors duration-150",
        // The affordance: a surface under the pointer says this is a thing you
        // can act on, before anyone has to guess.
        "hover:border-border hover:bg-surface",
        "focus:border-border focus:bg-background",
        // Spinners would appear on hover on a number field and change its
        // width, which for a value that is sized to its content means the whole
        // line reflowing as the pointer crosses it.
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        type !== "text" && "tabular-nums",
        saving && "opacity-60",
        autoSize ? "col-start-1 row-start-1 w-full min-w-0" : "w-auto",
        inputClassName,
      )}
    />
  );

  if (!autoSize) return <span className={cn("inline-flex items-center", className)}>{input}</span>;

  return (
    // The auto-sizing grid: an invisible copy of the text sets the column's
    // width and the input fills it, so the box is exactly as wide as what it
    // holds and grows as it is typed into. No measuring, no ref, no resize
    // observer. The browser does it as ordinary layout.
    <span
      // Baseline, not bottom: this sits inline in a sentence ("Antagen … –
      // skapad av …"), and an inline-grid takes its baseline from the first
      // item in its first row, the sizer, which carries exactly the text
      // metrics of the value. Aligning by the box instead would drop it by the
      // descender and leave the date sitting low against the words beside it.
      className={cn("inline-grid items-center align-baseline", className)}
    >
      <span
        aria-hidden
        className={cn(
          METRICS,
          "invisible col-start-1 row-start-1 whitespace-pre border border-transparent",
          type !== "text" && "tabular-nums",
        )}
      >
        {draft || placeholder || " "}
      </span>
      {input}
    </span>
  );
}
