"use client";

import { createContext, useContext, useId, useRef } from "react";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/ui/utils";
import { isCompleteDate } from "@/lib/domain/date";
import { DateInput as DateInputBase } from "./date-input";
import { IconButton } from "./icon-button";
import { IconCalendar } from "./icons";

/**
 * What a `Field` tells the one control inside it.
 *
 * Not props threaded through `children`, because a Field takes arbitrary nodes
 * and reaching into them means `cloneElement`, which breaks the moment somebody
 * wraps their input in a div. A context is asked for by whoever wants it.
 *
 * The id exists for two reasons and only one of them is the browser's. Chrome
 * warns that a field with neither id nor name cannot be autofilled, which is
 * the shallow half. The real half is that a Field draws a hint and, when what
 * is typed is refused, an error, and neither was tied to the control: a screen
 * reader read "Kvittodatum" and stopped, and the sentence explaining why the
 * date would not be accepted was on screen for people who could see it and
 * nowhere at all for anybody else.
 */
interface FieldWiring {
  /** The control's own id, so the label and the description can point at it. */
  id: string;
  /** Id of the hint or error paragraph under it, for `aria-describedby`. */
  describedBy?: string;
  /** Whether what is typed is currently refused. */
  invalid?: boolean;
}

const FieldCtx = createContext<FieldWiring | null>(null);

/**
 * The wiring for a control, whether or not it is inside a Field.
 *
 * Outside one it still gets an id of its own: a search box in a toolbar is a
 * form field too, and the id costs nothing.
 */
function useFieldWiring(given?: string): {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
} {
  const fallback = useId();
  const ctx = useContext(FieldCtx);
  return {
    // An id passed by the caller wins over both: it is the one another element
    // is already pointing at.
    id: given ?? ctx?.id ?? fallback,
    "aria-describedby": ctx?.describedBy,
    "aria-invalid": ctx?.invalid || undefined,
  };
}

/**
 * Whether a form can be submitted without this field.
 *
 * Both halves are said out loud, rather than one being marked and the other
 * left to be inferred from the absence of a mark. An unmarked field then means
 * one thing only: it is not part of a form that asks the question. A filter
 * bar's date range and a search box are not fields you have to fill in, they
 * are ways of looking at a list, and an asterisk on one would be answering a
 * question nobody asked.
 *
 * The two are marked differently on purpose. Required is a star on the name,
 * where the convention puts it and where the eye finds it while reading down a
 * column of labels. Optional is a word at the far end, because it is
 * permission rather than a demand and reads as an aside.
 */
type Requirement = "required" | "optional";

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

/**
 * The box a control wears when something is fastened inside it: a unit, or a
 * button. The ring goes round the pair rather than round the input, so focusing
 * the text does not outline half a field (see `focus-ring-within` in
 * globals.css).
 *
 * Named because two components draw it now, SuffixedInput and DateInput, and a
 * box that drifted between them would be two fields that look almost alike.
 */
const suffixBox = (size: Size, className?: string) =>
  cn("focus-ring-within flex items-center gap-1.5", control(size), className);

/**
 * The text inside such a box.
 *
 * `w-0` with a floor, not `w-full`: a flex child sized by its content refuses
 * to shrink past it, and a long value would push the suffix out of the box
 * rather than scroll under it. CONTROL's own placeholder rule is on the box,
 * where `::placeholder` matches nothing, so it is restated here on the element
 * that has one.
 */
const SUFFIXED_TEXT = "w-0 min-w-[4ch] flex-1 bg-transparent placeholder:text-muted/60";

function FieldContent({
  label,
  children,
  hint,
  error,
  action,
  requirement,
  describedBy,
}: {
  /** Id for the hint/error paragraph, where a control is listening for it. */
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
      {/* The label's own line, and it is a line whether or not anything else
          is on it: 24px, the height of the compact controls, so two fields side
          by side in a grid have their boxes at the same height even when one of
          them carries something up here.

          What may ride the far end is a second question about this same field
          (the utlägg's direction beside "Belopp"), which is how it gets asked
          without costing the form a row. */}
      <span className="mb-1.5 flex min-h-6 items-center justify-between gap-2 text-[13px] font-medium text-foreground">
        <span className="flex min-w-0 items-center gap-1">
          {label}
          {requirement === "required" && (
            <>
              {/* The star is a picture of a word, so the word is here too. A
                  <label> reads out everything inside it, which makes the
                  field's name "Namn krävs" to a screen reader and a bare
                  asterisk to nobody. */}
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
      {/* What's wrong with what's typed replaces the standing hint. Two lines
          of small text under one control read as one sentence and neither
          lands. Same warning colour as the submit blocker on the last step.

          Carries the id the control points `aria-describedby` at, so whichever
          of the two is showing is the one read out after the label. */}
      {error ? (
        <span id={describedBy} className="mt-1 block text-xs text-warning">{error}</span>
      ) : (
        hint && <span id={describedBy} className="mt-1 block text-xs text-muted">{hint}</span>
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
  requirement,
  children,
}: {
  label: string;
  hint?: string;
  /** Shown in place of `hint` while what's typed isn't accepted. */
  error?: string;
  /** See Requirement. Left off outside a form, where the question is not asked. */
  requirement?: Requirement;
  children: React.ReactNode;
}) {
  const id = useId();
  // Only where there is something to point at. An empty `aria-describedby` is
  // a promise of a description that is not there.
  const describedBy = error || hint ? `${id}-note` : undefined;
  return (
    // The label wraps the control, which is what associates the two and what
    // makes clicking the words focus it. No `htmlFor`: it would have to name
    // the control's id, and a Field takes arbitrary children, so anything that
    // does not ask for the wiring below would leave the label pointing at an
    // id no element carries. Worse than the implicit association it duplicates.
    // The provider is outside the label, not between it and its contents: a
    // <label> whose only child is a context provider stops looking like a
    // label to anything reading the tree, tooling included.
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

// A label for a composite: a picker, a row of choice buttons, a whole sub-editor.
//
// Deliberately not a <label>. A <label> forwards a click anywhere in its box to
// the first labelable element inside it, and <button> is labelable, so
// wrapping a Combobox (whose trigger is a button) meant clicking the empty space
// beside or below it popped the menu open. Here the label only labels.
export function FieldGroup({
  label,
  hint,
  action,
  requirement,
  children,
}: {
  label: string;
  hint?: string;
  /** A control on the label's own line, at the far end. For a question about
   *  the field that would otherwise cost the form a row of its own. */
  action?: React.ReactNode;
  /** See Requirement. Left off outside a form, where the question is not asked. */
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
  // React 19 passes `ref` as an ordinary prop, so this needs declaring and
  // nothing else. A screen that moves focus for you (the stock register hands
  // it back and forth between a product and a count for a whole pallet) has to
  // be able to reach the element.
  ref?: React.Ref<HTMLInputElement>;
}) {
  const wiring = useFieldWiring(id);
  return <input {...wiring} className={control(size, className)} {...props} />;
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
      className={control("md", cn("min-h-24 resize-y", className))}
      {...props}
    />
  );
}

/**
 * A date field: the mask to type into, and a calendar to pick from.
 *
 * Two ways in, because the two suit different moments. Typing is faster for a
 * date you know ("19032026" is eight keystrokes and no aiming), and a calendar
 * is what you want for "the Tuesday before the pub", which is a date nobody
 * holds as digits. The mask stays the field; the calendar is a shortcut into
 * it, the same shape as the barcode scanner fastened inside the EAN field.
 *
 * The calendar itself is the browser's. It is the one control here that is not
 * drawn in the app's own hand, and that is a trade taken deliberately: a date
 * grid is not a checkbox. Doing it ourselves means a month grid, keyboard
 * arrows, week starts per locale, focus trapping and a positioned popover,
 * several hundred lines to reimplement something every browser already ships,
 * localises and makes accessible, and on a phone the native one is a far better
 * control than anything we would put there. If the OS look ever grates enough
 * to be worth that, this is the one place it would be replaced.
 */
export function DateInput({
  className,
  size = "md",
  value,
  onChange,
  disabled,
  id,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & { size?: Size }) {
  const t = useTranslations("common");
  // On the masked input, not on the box or the hidden picker: it is the one a
  // reader lands on and the one the Field's hint is describing.
  const wiring = useFieldWiring(id);
  const picker = useRef<HTMLInputElement>(null);

  const openPicker = () => {
    const el = picker.current;
    if (!el) return;
    // `showPicker` throws where the browser will not allow it and is missing
    // from older ones. Focusing the control is the honest fallback: whatever a
    // browser does with a focused date input beats a button that does nothing.
    try {
      el.showPicker();
    } catch {
      el.focus();
    }
  };

  return (
    // `relative`, for the hidden native control below. `pr-1` so the button can
    // sit near the edge, as the scanner does in the EAN field.
    //
    // The disabled look is spelled out rather than left to CONTROL, whose
    // `disabled:` rules key off the element carrying the attribute and here
    // that is the input inside, not the box. SuffixedInput has the same gap and
    // says so; this one is closed because DateInput takes `disabled` as a prop
    // and a field that ignored it would look editable while refusing to be.
    <div
      className={suffixBox(
        size,
        cn("relative pr-1", disabled && "cursor-not-allowed bg-surface text-muted", className),
      )}
    >
      <DateInputBase
        {...wiring}
        {...props}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={SUFFIXED_TEXT}
      />
      {/* The calendar the button opens, kept out of sight and out of the tab
          order: it is not a second field to fill in. Placed at the bottom of
          the box rather than at its origin so the popup the browser anchors to
          it opens under the field it belongs to.

          `visibility` rather than `display: none` or width zero alone: a
          browser will refuse to open a picker for a control it considers
          unrendered, and several refuse silently. */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        // Whole dates only. The mask holds "2026" and "2026-07" while somebody
        // is part-way through typing, and a native date input handed a partial
        // value clears itself, which would open an empty calendar on a field
        // that visibly has a year in it.
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
        // Gives up its vertical margin so it does not set the box's height:
        // a tappable button inside a field that still measures what its
        // neighbours do.
        className="-my-1.5"
      >
        <IconCalendar className="size-4" />
      </IconButton>
    </div>
  );
}

