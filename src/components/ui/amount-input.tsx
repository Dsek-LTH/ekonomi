"use client";

// A field you type money into.
//
// Every amount field in the app repeated the same three lines (`inputMode`,
// the `isAmountInput` guard, and a raw string of kronor) and every one of them
// had the same two holes on a phone, which is where most utlägg are actually
// filed:
//
//   • the decimal separator. A phone's decimal pad offers whatever its *device*
//     locale uses, so a Swedish member with an English phone gets a full stop
//     and no comma. Both have always parsed; what was missing is that the field
//     then sat there reading "12.50" in a form where everything else is written
//     with a comma. It is taken as typed and shown back as a comma on blur.
//
//   • the minus. No mobile numeric keypad has one, not iOS's, not Android's,
//     at any `inputMode`, so a negative amount could not be entered on a phone
//     at all. A return is an ordinary thing here (the same utlägg with the sign
//     flipped, which the edit route and the allocations both handle), so where
//     one is meaningful the sign gets a button rather than being unreachable.
//
// Not `type="number"`: it drops a lone leading "-" from `.value`, refuses
// "1 234,50", and hands back a locale-dependent empty string for anything it
// dislikes, so a half-typed amount vanishes as you type it.
import { commaForm, isAmountInput } from "@/lib/domain/money";
import { Input, type ControlSize } from "@/components/ui/field";
import { cn } from "@/lib/ui/utils";

/**
 * The props any amount field needs, for an input that draws itself.
 *
 * For the ones inside a table (the voucher's debit and credit columns, an
 * allocation row) which carry their own classes and cannot be a boxed control.
 * Spread it over a bare `<input>` and the guard, the keypad and the separator
 * all come with it.
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
 * The two halves of a signed amount field, mirroring CONTROL_SIZES.
 *
 * The border, the rounding and the height belong to the box; the padding
 * belongs to the parts inside it. So the sizes are split here rather than taken
 * whole. A control that put `px` on the wrapper would inset its own segments.
 */
const SPLIT_SIZES: Record<ControlSize, { box: string; cell: string }> = {
  sm: { box: "h-11 rounded-lg sm:h-9", cell: "px-2.5" },
  md: { box: "rounded-xl", cell: "px-3.5 py-2.5" },
};

/**
 * An amount whose sign is a part of the field rather than a character in it.
 *
 * The sign was a minus typed into the box, and on a phone that is not something
 * anybody can do. No mobile numeric keypad has the key. So it stops being text
 * at all: the field is split, the left cell holds the sign and cannot be typed
 * in, and the digits beside it are only ever a magnitude. Pressing the cell is
 * the only way the sign changes, which also means the guard on the text no
 * longer has to allow a character the keypad cannot produce.
 *
 * The value handed up is still the ordinary signed string, "-1234,50", since
 * that is what `parseSEK` reads and what every caller stores. The split is what
 * the reader sees, not what the form holds.
 *
 * `label` is the word beside the glyph, and it is the difference between the
 * two places this is used. The utlägg's own total says "Retur", because that is
 * what a negative total *is* and the field has room to say it. A row of the
 * distribution underneath says nothing. It is one line of a sum, its sign
 * decides whether it adds or subtracts, and five controls already share that
 * row. Same control, and the word only where it is the whole meaning.
 */
export function SignedAmountInput({
  value,
  onChange,
  label,
  title,
  size = "md",
  className,
  inputClassName,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  /** The word beside the sign. Omitted, the cell is the glyph alone. */
  label?: string;
  /** The longer phrasing, for a pointer. */
  title?: string;
  size?: ControlSize;
  className?: string;
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size">) {
  const negative = value.startsWith("-");
  const magnitude = negative ? value.slice(1) : value;
  const sizes = SPLIT_SIZES[size];

  // The box takes the sign back off the text on the way in, and puts it back on
  // the way out. A minus reaching this from a hardware keyboard is refused: the
  // sign has a control of its own now, and two ways to set one thing is how the
  // two disagree.
  const field = amountFieldProps({
    value: magnitude,
    onChange: (next) => onChange(next.startsWith("-") ? value : (negative ? "-" : "") + next),
  });

  return (
    <div
      className={cn(
        "focus-ring-within flex items-stretch overflow-hidden border bg-background text-sm",
        "transition-[color,background-color,border-color] duration-150",
        sizes.box,
        // The whole field answers, not just the cell. A figure the section is
        // getting back rather than paying out is worth more than one character.
        negative ? "border-danger" : "border-border",
        className,
      )}
    >
      {/* No `aria-label`: with a word on it the button says what it is, and a
          label reading "Växla till negativt belopp" over a face reading "Retur"
          is the mismatch WCAG 2.5.3 is about. Someone driving this by voice
          says what they can see. Without a word there is nothing to read, so
          the title carries the name instead. `aria-pressed` has the state
          either way. */}
      <button
        type="button"
        onClick={() => onChange(negative ? magnitude : `-${magnitude}`)}
        title={title}
        aria-label={label ? undefined : title}
        aria-pressed={negative}
        className={cn(
          "flex shrink-0 items-center gap-1 border-r font-medium",
          "transition-[color,background-color,border-color] duration-150",
          sizes.cell,
          negative
            ? "border-danger bg-danger-soft text-danger"
            : "border-border text-muted hover:bg-surface hover:text-foreground",
        )}
      >
        {/* U+2212, not a hyphen: it is the character the figure beside it is
            printed with, and at this size a hyphen reads as a dash. */}
        <span aria-hidden className="text-base leading-none">
          {negative ? "\u2212" : "+"}
        </span>
        {label}
      </button>

      <input
        {...props}
        {...field}
        className={cn(
          "w-full min-w-0 flex-1 bg-transparent tabular-nums placeholder:text-muted/60",
          sizes.cell,
          negative && "text-danger",
          inputClassName,
        )}
      />
    </div>
  );
}

/**
 * The plain amount field, for the amounts that cannot be negative.
 *
 * A voucher line is a positive figure on one side or the other, and a schablon
 * is not a debt. Where a return is a real case, an utlägg's total and the rows
 * it is split across, the caller reaches for SignedAmountInput instead.
 */
export function AmountInput({
  value,
  onChange,
  size = "md",
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  size?: ControlSize;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size">) {
  return (
    <Input
      {...props}
      {...amountFieldProps({ value, onChange })}
      size={size}
      className={cn("tabular-nums", className)}
    />
  );
}
