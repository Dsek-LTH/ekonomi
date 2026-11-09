"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import { formatDate, formatDateTime } from "./format";

/** The date formatters bound to the reader's language. `list` joins names per language. Amounts are not here: SEK is the same in every language (format.ts). */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      date: (iso: string) => formatDate(iso, locale),
      dateTime: (iso: string) => formatDateTime(iso, locale),
      list: (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items),
    }),
    [locale],
  );
}
