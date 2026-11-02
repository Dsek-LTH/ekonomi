"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { IconPencil } from "@/components/ui/icons";
import { DateInput } from "@/components/ui/field";
import { isCompleteDate } from "@/lib/domain/date";

// A value that is an input the whole time, dressed as plain text until you go
// near it: transparent and borderless at rest, gaining a surface on hover and a
// border and caret on focus. Click and type. There is no mode to enter, and no
// moment where the thing under the pointer changes into a different thing.
//
// A pencil sits after it all the same. Dressed as plain text, the field gave no
// sign at rest that it could be edited, and the hover surface only helps
// someone who already thought to point at it. The pencil is a sign, not a mode:
// clicking it just puts the caret in the field.
//
// Enter commits, Escape puts back what was there, and clicking away commits
// too: leaving a field is how every other cell in this app is finished, and
// silently discarding what someone typed is the worse surprise.
//
// This is how every single value in the app is edited: a title, a name, a
// label, a date. Not a dialog, and not an input that appears with its own
// Spara and Avbryt. A record with several fields is the other case, edited in
// a dialog opened from "Ändra" in its ⋯ menu.
//
// The text inherits the surrounding type, so the same component is a page title
// in one place and a table cell in another. Width comes from the content (see
// the sizer below) rather than from the call site, which is what keeps it
// reading as a word in a sentence instead of as a form field parked in one.

// Shared by the input and its sizer. Every property that affects text metrics
// has to be identical on both or the box will not match what is typed in it,
// so they are written once here rather than kept in step by hand.
const METRICS =
  "px-1.5 py-0.5 text-[length:inherit] font-[inherit] leading-[inherit] tracking-[inherit]";

export function EditableText({
  value,
  onSave,
  label,
  type = "text",
  placeholder,
  maxLength,
  disabled,
  className,
  inputClassName,
  pencil: showPencil = true,
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
  /** "date" is the app's own DateInput, mask and calendar, and commits a YYYY-MM-DD. */
  type?: "text" | "number" | "date";
  placeholder?: string;
  maxLength?: number;
  /** Read-only: the plain text, with no input behind it at all. */
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  /** The pencil after the value. Off where the field is already plainly one. */
  pencil?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  // Escape blurs the input, and the blur would otherwise commit the very edit
  // that was just abandoned.
  const abandoned = useRef(false);
  // The date field's input belongs to DateInput, which keeps its own ref, so it
  // is found by the id handed to it instead.
  const field = () =>
    inputRef.current ?? (document.getElementById(autoId) as HTMLInputElement | null);

  // Adopt a value that changed underneath us (a save landing, a router
  // refresh, another tab) but never while the field has focus, where it would
  // overwrite what someone is in the middle of typing.
  useEffect(() => {
    const el = inputRef.current ?? document.getElementById(autoId);
    if (document.activeElement !== el) setDraft(value);
  }, [value, autoId]);

  async function commit(next = draft) {
    if (abandoned.current || saving) return;
    if (next === value) return; // nothing to write
    setSaving(true);
    const ok = await onSave(next);
    setSaving(false);
    // Rejected: the caller has said why, and the value is still wrong, so the
    // caret goes back where it can be fixed. Accepted: the new `value` arrives
    // as a prop and the effect above syncs the draft to it.
    if (ok === false) field()?.focus();
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

  if (type === "date") {
    return (
      <DateInput
        id={autoId}
        size="sm"
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          // Saved as soon as it is a whole date. A date picked from the
          // calendar never focuses the field, so no blur would follow it.
          if (isCompleteDate(next)) {
            abandoned.current = false;
            void commit(next);
          }
        }}
        onFocus={() => {
          abandoned.current = false;
        }}
        // Emptied, it clears. Left half typed, it goes back to what was saved.
        onBlur={() => (draft === "" ? void commit() : !isCompleteDate(draft) && setDraft(value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            field()?.blur();
          }
          if (e.key === "Escape") {
            abandoned.current = true;
            setDraft(value);
            field()?.blur();
          }
        }}
        // Dressed as text at rest, as the text field is, with the box
        // appearing under the pointer and while typing. The calendar button
        // is the sign that it can be changed, so it needs no pencil. Marked
        // important because `cn` joins rather than merges, and the box's own
        // border and background would otherwise win or lose by CSS order.
        className={cn(
          "inline-flex! w-auto! border-transparent! bg-transparent! text-inherit! text-[length:inherit]!",
          "hover:border-border-control! hover:bg-hover! focus-within:border-border-control! focus-within:bg-background!",
          saving && "opacity-60",
          className,
        )}
      />
    );
  }

  const input = (
    <input
      ref={inputRef}
      // Named so the browser does not report a field it cannot autofill. It is
      // dressed as plain text until you go into it, but it is an input the
      // whole time (see the note at the top).
      id={autoId}
      value={draft}
      type={type}
      // An input asks for about twenty characters of width by default, and in
      // the grid below that request sizes the column, pushing the pencil away
      // from the text. One character leaves the sizer as the widest thing in
      // the column, so the box is as wide as the text and no wider.
      size={1}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => {
        abandoned.current = false;
      }}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          inputRef.current?.blur();
        }
        if (e.key === "Escape") {
          abandoned.current = true;
          setDraft(value);
          inputRef.current?.blur();
        }
      }}
      placeholder={placeholder}
      maxLength={maxLength}
      aria-label={label}
      className={cn(
        METRICS,
        // Text at rest. The border is transparent rather than absent so that
        // gaining one on hover does not move the text by a pixel.
        "rounded-control border border-transparent bg-transparent text-inherit",
        "placeholder:text-muted transition-colors duration-150",
        // The affordance: a surface under the pointer says this is a thing you
        // can act on, before anyone has to guess.
        "hover:border-border hover:bg-hover",
        "focus:border-border focus:bg-background",
        // Spinners would appear on hover on a number field and change its
        // width, which for a value that is sized to its content means the whole
        // line reflowing as the pointer crosses it.
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        type !== "text" && "tabular-nums",
        saving && "opacity-60",
        "col-start-1 row-start-1 w-full min-w-0",
        inputClassName,
      )}
    />
  );

  // Out of the tab order, since the input it points at is already in it.
  const pencil = showPencil && (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      onClick={() => inputRef.current?.focus()}
      className="shrink-0 rounded-control p-0.5 text-muted transition-colors duration-150 hover:bg-hover hover:text-foreground"
    >
      <IconPencil className="size-[0.9em]" />
    </button>
  );

  return (
    // The auto-sizing grid: an invisible copy of the text sets the column's
    // width and the input fills it, so the box is exactly as wide as what it
    // holds and grows as it is typed into. No measuring, no ref, no resize
    // observer. The browser does it as ordinary layout.
    <span
      // Baseline, not bottom: this can sit inline in a sentence, and an
      // inline-grid takes its baseline from the first item in its first row,
      // the sizer, which carries exactly the text metrics of the value.
      // Aligning by the box instead would drop it by the descender and leave
      // the value sitting low against the words beside it.
      className={cn("inline-grid grid-cols-[auto_auto] items-center align-baseline", className)}
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
      {pencil && <span className="col-start-2 row-start-1 inline-flex">{pencil}</span>}
    </span>
  );
}
