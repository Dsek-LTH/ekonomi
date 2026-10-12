"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { formatDate, formatDateTime } from "./format";

/**
 * The date formatters, bound to the language the reader is in.
 *
 *     const { date } = useFormat();
 *     <td>{date(expense.purchaseDate)}</td>
 *
 * `list` joins names the way the language does: "Anna, Bo och Cia" in
 * Swedish, "Anna, Bo, and Cia" in English.
 *
 * Amounts are not here: SEK is formatted the same in every language (see
 * format.ts), so `formatSEK` is imported directly wherever it is needed.
 */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      date: (iso: string) => formatDate(iso, locale),
      dateTime: (iso: string) => formatDateTime(iso, locale),
      list: (items: string[]) =>
        new Intl.ListFormat(locale, { type: "conjunction" }).format(items),
    }),
    [locale],
  );
}

