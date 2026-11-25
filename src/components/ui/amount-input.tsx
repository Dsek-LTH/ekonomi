"use client";

// Accepts a full stop (a device-locale decimal pad). On blur the value is written out in full,
// "1000" → "1 000,00" (sekToInput), and that text is what the field holds from then on, so it reads
// the same idle and focused. No sign key: a phone's number pad has no minus.
// Not type="number": it drops a lone "-", refuses "1 234,50" and blanks half-typed input.
import { fullAmountForm, isAmountInput } from "@/lib/domain/money";
import { Input, SuffixedInput, type ControlSize } from "@/components/ui/field";
import { cn } from "@/lib/ui/utils";

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
      if (!isAmountInput(e.target.value)) return;
      onChange(e.target.value);
    },
    // On blur, not per keystroke: rewriting the separator moves the caret.
    onBlur: () => {
      const shown = fullAmountForm(value);
      if (shown !== value) onChange(shown);
    },
  };
}

/** Holds "1 234,50" once left, the same text idle or focused. Can carry its unit inside the box. */
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
  suffix?: React.ReactNode;
  size?: ControlSize;
  className?: string;
  inputClassName?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "size">) {
  const field = amountFieldProps({ value, onChange });

  const shared = {
    ...props,
    ...field,
    onFocus,
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
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
