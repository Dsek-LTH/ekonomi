"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";

// Clamp a fully-entered 2-digit segment to [01, max]. Only runs when both
// digits are present so partial input (e.g. "3" while still typing "03") is
// left untouched.
function clamp2(twoDigits: string, max: number): string {
  const n = parseInt(twoDigits, 10);
  if (n < 1) return "01";
  if (n > max) return String(max).padStart(2, "0");
  return twoDigits;
}

function daysInMonth(year: string, month: string): number {
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  if (year.length < 4 || month.length < 2 || !y || m < 1 || m > 12) return 31;
  // Day 0 of month m+1 (JS 0-indexed) = last day of month m.
  return new Date(y, m, 0).getDate();
}

function formatDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const year = digits.slice(0, 4);
  const monthRaw = digits.slice(4, 6);
  const dayRaw = digits.slice(6, 8);
  const month = monthRaw.length === 2 ? clamp2(monthRaw, 12) : monthRaw;
  const day = dayRaw.length === 2 ? clamp2(dayRaw, daysInMonth(year, month)) : dayRaw;

  if (digits.length <= 4) return year;
  if (digits.length <= 6) return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

export function DateInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">) {
  // The mask itself is ISO in every language; only the letters standing in for
  // year/month/day change.
  const t = useTranslations("common");
  const ref = useRef<HTMLInputElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const cursorBefore = e.target.selectionStart ?? e.target.value.length;
    const digitsBeforeCursor = e.target.value
      .slice(0, cursorBefore)
      .replace(/\D/g, "").length;

    const formatted = formatDate(e.target.value);

    let newCursor = formatted.length;
    let digitsSeen = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (/\d/.test(formatted[i])) {
        digitsSeen++;
        if (digitsSeen === digitsBeforeCursor) {
          newCursor = i + 1;
          break;
        }
      }
    }

    onChange?.({
      target: { value: formatted },
    } as React.ChangeEvent<HTMLInputElement>);

    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.selectionStart = newCursor;
        ref.current.selectionEnd = newCursor;
      }
    });
  };

  return (
    <input
      ref={ref}
      inputMode="numeric"
      placeholder={t("datePlaceholder")}
      className={className}
      value={value}
      onChange={handleChange}
      {...props}
    />
  );
}
