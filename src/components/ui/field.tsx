"use client";

import { createContext, useContext, useId, useRef } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/ui/utils";
import { isCompleteDate } from "@/lib/domain/date";
import { DateInput as DateInputBase } from "./date-input";
import { IconButton } from "./icon-button";
import { IconCalendar } from "./icons";

/** What a Field tells its control, by context (cloneElement breaks when the input is wrapped). The id ties the hint and error to the control for screen readers. */
interface FieldWiring {
  id: string;
  describedBy?: string;
  invalid?: boolean;
}

const FieldCtx = createContext<FieldWiring | null>(null);

/** The wiring for a control, inside a Field or not. */
function useFieldWiring(given?: string): {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
} {
  const fallback = useId();
  const ctx = useContext(FieldCtx);
  return {
    // An id passed by the caller wins: another element already points at it.
    id: given ?? ctx?.id ?? fallback,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": ctx?.invalid || undefined,
  };
}

/** Both halves are said out loud, so an unmarked field means it is not part of a form that asks. Required is a star on the name, optional a word at the far end. */
type Requirement = "required" | "optional";

// No focus styling here: the app draws one ring from globals.css.
const CONTROL =
  "w-full border border-border-control bg-background text-sm text-foreground placeholder:text-muted transition-[color,background-color] duration-150 disabled:bg-surface disabled:text-muted disabled:cursor-not-allowed";

// "md" is the form control; "sm" the compact one. Exported so the combobox shares the same strings.
export type ControlSize = "sm" | "md";
type Size = ControlSize;
// Each is two heights: 44 below sm (touch target), 32 from sm up. Both registers share a height from sm up; padding tells them apart.
export const CONTROL_SIZES: Record<ControlSize, string> = {
  // `field-ring` puts the focus ring on the field's own border (see globals.css).
  sm: "field-ring h-11 rounded-control px-2.5 sm:h-8",
  md: "field-ring h-11 rounded-control px-2.5 sm:h-8",
};

/** A cell of a table from its container's 2xl up: no box, the grid lines are the boxes. Overrides CONTROL_SIZES.sm only inside the container query. */
export const CONTROL_CELL =
  "@2xl:h-10 @2xl:rounded-none @2xl:border-0 @2xl:bg-transparent focus-inset";

// Sized by padding, not height, so a single line lands at 32px.
const TEXTAREA = "field-ring rounded-control px-2.5 py-1.5";
const SIZES = CONTROL_SIZES;
const control = (size: Size, className?: string) => cn(CONTROL, SIZES[size], className);

/** The box for a control with something fastened inside: the ring goes round the pair (see `focus-ring-within` in globals.css). */
const suffixBox = (size: Size, className?: string) =>
  cn("focus-ring-within flex items-center gap-1.5", control(size), className);

/** The text inside such a box. `w-0` with a floor, not `w-full`: a content-sized flex child would push the suffix out. The placeholder rule is restated here because it matches nothing on the box. */
const SUFFIXED_TEXT = "w-0 min-w-[4ch] flex-1 bg-transparent placeholder:text-muted";

function FieldContent({
  label,
  children,
  hint,
  error,
  action,
  requirement,
  describedBy,
}: {
  describedBy?: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
  error?: string;
  action?: React.ReactNode;
  requirement?: Requirement;
}) {
  const t = useTranslations("common.field");
  return (
    <>
      {/* 20px line so fields side by side align even when one carries something at the far end. */}
      <span className="mb-1 flex min-h-5 items-center justify-between gap-2 text-[13px] font-medium text-foreground">
        <span className="flex min-w-0 items-center gap-1">
          {label}
          {requirement === "required" && (
            <>
              {/* The star is aria-hidden, so the word is here too. */}
              <span aria-hidden className="text-accent">
                *
              </span>
              <span className="sr-only">{t("required")}</span>
            </>
          )}
        </span>
        {(requirement === "optional" || action) && (
          <span className="flex shrink-0 items-center gap-2">
            {requirement === "optional" && (
              <span className="text-xs font-normal text-muted">{t("optional")}</span>
            )}
            {action}
          </span>
        )}
      </span>
      {children}
      {/* Replaces the standing hint, and carries the id aria-describedby points at. */}
      {error ? (
        <span id={describedBy} className="mt-1 block text-xs text-warning">
          {error}
        </span>
      ) : (
        hint && (
          <span id={describedBy} className="mt-1 block text-xs text-muted">
            {hint}
          </span>
        )
      )}
    </>
  );
}

export function Field({
  label,
  hint,
  error,
  requirement,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  requirement?: Requirement;
  children: React.ReactNode;
}) {
  const id = useId();
  // An empty aria-describedby promises a description that is not there.
  const describedBy = error || hint ? `${id}-note` : undefined;
  return (
    // The label wraps the control (no htmlFor: a Field takes arbitrary children). The provider is outside the label, or the label stops looking like one to the tree.
    <FieldCtx.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <label className="block">
        <FieldContent
          label={label}
          hint={hint}
          error={error}
          requirement={requirement}
          describedBy={describedBy}
        >
          {children}
        </FieldContent>
      </label>
    </FieldCtx.Provider>
  );
}

// Not a <label>: it would forward clicks to the first labelable element, and a Combobox trigger is a button.
export function FieldGroup({
  label,
  hint,
  action,
  requirement,
  children,
}: {
  label: string;
  hint?: string;
  action?: React.ReactNode;
  requirement?: Requirement;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="block">
      <FieldContent label={label} hint={hint} action={action} requirement={requirement}>
        {children}
      </FieldContent>
    </div>
  );
}

export function Input({
  className,
  size = "md",
  id,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  size?: Size;
  // Declared so screens can move focus to it (React 19 passes ref as a prop).
  ref?: React.Ref<HTMLInputElement>;
}) {
  const wiring = useFieldWiring(id);
  return <input {...wiring} className={control(size, className)} {...props} />;
}

/** An input with something fastened to the end inside the same border (a unit, or a button). `className` dresses the box, `inputClassName` the text. No disabled styling yet: CONTROL's rules key off the input. */
export function SuffixedInput({
  suffix,
  size = "md",
  className,
  inputClassName,
  id,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & {
  suffix: React.ReactNode;
  size?: Size;
  className?: string;
  inputClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className={suffixBox(size, className)}>
      <input {...useFieldWiring(id)} {...props} className={cn(SUFFIXED_TEXT, inputClassName)} />
      {suffix}
    </div>
  );
}

export function Textarea({
  className,
  id,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const wiring = useFieldWiring(id);
  return (
    <textarea
      {...wiring}
      className={cn(CONTROL, TEXTAREA, "min-h-24 resize-y", className)}
      {...props}
    />
  );
}

/** A date field: a mask to type into and a native calendar to pick from (the browser's, deliberately). */
export function DateInput({
  className,
  size = "md",
  value,
  onChange,
  disabled,
  id,
  min,
  max,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & { size?: Size }) {
  const t = useTranslations("common");
  const wiring = useFieldWiring(id);
  const picker = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    // showPicker throws where not allowed and is missing from older browsers: focusing is the fallback.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    // relative for the hidden native control; pr-1 so the button sits near the edge. The disabled look is spelled out because CONTROL's rules key off the inner input. min-w-fit keeps the box from clipping a whole date.
    <div
      className={suffixBox(
        size,
        cn(
          "relative min-w-fit pr-1",
          disabled && "cursor-not-allowed bg-surface text-muted",
          className,
        ),
      )}
    >
      <DateInputBase
        {...wiring}
        {...props}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={cn(SUFFIXED_TEXT, "min-w-[10ch] tabular-nums")}
      />
      {/* The native calendar, hidden but not display:none (browsers refuse to open a picker for an unrendered control). Placed at the bottom so the popup opens under the field. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        // The calendar's range, for a field kept to one räkenskapsår.
        min={min}
        max={max}
        // Whole dates only: a native date input handed a partial value clears itself.
        value={isCompleteDate(String(value ?? "")) ? String(value) : ""}
        onChange={(e) =>
          onChange?.({
            target: { value: e.target.value },
          } as React.ChangeEvent<HTMLInputElement>)
        }
        className="pointer-events-none absolute bottom-0 left-2 size-0 opacity-0"
      />
      <IconButton
        label={t("openDatePicker")}
        disabled={disabled}
        onClick={openPicker}
        // Gives up its vertical margin so it does not set the box's height.
        className="-my-1.5"
      >
        <IconCalendar className="size-4" />
      </IconButton>
    </div>
  );
}
