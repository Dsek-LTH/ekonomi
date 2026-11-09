"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/ui/utils";
import { IconPencil } from "@/components/ui/icons";
import { DateInput } from "@/components/ui/field";
import { isCompleteDate } from "@/lib/domain/date";

// An input the whole time, dressed as plain text at rest. Enter commits, Escape reverts, blur commits.
// Width follows the content via the sizer below.

// Shared by the input and its sizer: text metrics must be identical on both.
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
  /** Commit. Return `false` to reject the value and keep the caret in the field. */
  onSave: (value: string) => boolean | void | Promise<boolean | void>;
  label: string;
  /** "date" is the app's own DateInput, mask and calendar, and commits a YYYY-MM-DD. */
  type?: "text" | "number" | "date";
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  pencil?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  // Escape blurs, and the blur would otherwise commit the abandoned edit.
  const abandoned = useRef(false);
  // The date field's input belongs to DateInput, so it is found by id.
  const field = () =>
    inputRef.current ?? (document.getElementById(autoId) as HTMLInputElement | null);

  // Adopt a changed value, but never while focused (it would overwrite typing).
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
    if (ok === false) field()?.focus();
  }

  // No input at all when not editable, so tabbing does not stop on a dead field.
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
        // Important because cn joins rather than merges: the box's own border and background would win or lose by CSS order.
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
      // Named so the browser does not report a field it cannot autofill.
      id={autoId}
      value={draft}
      type={type}
      // An input asks for ~20 characters by default and would size the grid column: one character keeps the sizer widest.
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
        // The border is transparent, not absent, so gaining one on hover does not move the text.
        "rounded-control border border-transparent bg-transparent text-inherit",
        "placeholder:text-muted transition-colors duration-150",
        "hover:border-border hover:bg-hover",
        "focus:border-border focus:bg-background",
        // No spinners: they would appear on hover and reflow the line.
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        type !== "text" && "tabular-nums",
        saving && "opacity-60",
        "col-start-1 row-start-1 w-full min-w-0",
        inputClassName,
      )}
    />
  );

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
    <span
      // Baseline, not bottom: inline-grid takes its baseline from the sizer, which has the text metrics.
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
