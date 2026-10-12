"use client";

// A field you type money into.
//
// Every amount field in the app repeated the same three lines (`inputMode`,
// the `isAmountInput` guard, and a raw string of kronor) and every one of them
// had the same hole on a phone, which is where most utlägg are actually filed:
// the decimal separator. A phone's decimal pad offers whatever its *device*
// locale uses, so a Swedish member with an English phone gets a full stop and
// no comma. Both have always parsed; what was missing is that the field then
// sat there reading "12.50" in a form where everything else is written with a
// comma. It is taken as typed and shown back as a comma on blur.
//
// What this field is not asked to do is anything the keyboard cannot type. A
// phone's number pad is ten digits and a separator: no minus, at any inputmode
// and behind no pattern, and no plus either, since iOS draws the decimal pad as
// its telephone pad with `+ * #` swapped for the separator. Both were tried
// here, as a sign cell inside the field and then as a strip floated over the
// keyboard, and the second one loses: the web has no `inputAccessoryView`, so a
// strip can only guess where the keyboard is, and on iOS it guesses wrong and
// lands in the row Safari keeps for its own AutoFill icons.
//
// So the form asks differently instead. A figure is a magnitude, one per field;
// which way the money goes is a control of its own on the utlägg (see the
// wizard's direction toggle), and a receipt of several lines is several rows.
// Nothing here needs a key that is not on the pad.
//
// Not `type="number"`: it drops a lone leading "-" from `.value`, refuses
// "1 234,50", and hands back a locale-dependent empty string for anything it
// dislikes, so a half-typed amount vanishes as you type it.
import { useState } from "react";

import { commaForm, groupForm, isAmountInput } from "@/lib/domain/money";
import { Input, SuffixedInput, type ControlSize } from "@/components/ui/field";
import { cn } from "@/lib/ui/utils";

/**
 * The props any amount field needs, for an input that draws itself.
 *
 * For the ones inside a table (the voucher's debit and credit columns) which
 * carry their own classes and cannot be a boxed control. Spread it over a bare
 * `<input>` and the guard, the keypad and the separator all come with it.
 */
export function amountFieldProps({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return {
    value,
    inputMode: "decimal" as const,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      // Anything not on its way to an amount is simply not taken, so the field
      // keeps what it had rather than flickering through a value nobody typed.
      if (!isAmountInput(e.target.value)) return;
      onChange(e.target.value);
    },
    // On blur, not on every keystroke: rewriting the separator under the caret
    // moves it, and "12." is a perfectly ordinary thing to be half-way through
    // typing.
    onBlur: () => {
      const shown = commaForm(value);
      if (shown !== value) onChange(shown);
    },
  };
}

/**
 * The boxed amount field: an utlägg's total, and each row it is split across.
 *
 * Two things beyond the props above.
 *
 * While nobody is in it the figure is grouped the way it is read (1 234,50) and
 * while somebody is it is exactly what they typed, because a thousands space is
 * pleasant to read and miserable to backspace through.
 *
 * And it can carry its unit inside the box, the way the strength field on a
 * stock product carries its "%". A "kr" standing outside the field is a third
 * thing on a crowded row, and the first to be mistaken for a word in the
 * comment beside it; inside, it is part of the figure it belongs to.
 */
export function AmountInput({
  value,
  onChange,
  suffix,
  size = "md",
  className,
  inputClassName,
  onFocus,
  onBlur,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  /** The unit, inside the box: "kr". Hidden from a screen reader, which has the
   *  field's own label to go on. */
  suffix?: React.ReactNode;
  size?: ControlSize;
  /** The control: its width and where it sits. */
  className?: string;
  /** The text inside it: an alignment. Without a suffix there is one element
   *  and both land on it. */
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size">) {
  const [focused, setFocused] = useState(false);
  const field = amountFieldProps({ value, onChange });

  const shared = {
    ...props,
    ...field,
    value: focused ? value : groupForm(value),
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      onFocus?.(e);
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(false);
      field.onBlur();
      onBlur?.(e);
    },
    size,
  };

  if (suffix != null) {
    return (
      <SuffixedInput
        {...shared}
        className={className}
        inputClassName={cn("tabular-nums", inputClassName)}
        suffix={
          <span aria-hidden className="shrink-0 text-xs text-muted">
            {suffix}
          </span>
        }
      />
    );
  }
  return <Input {...shared} className={cn("tabular-nums", className, inputClassName)} />;
}
