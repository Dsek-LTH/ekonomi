// Which of Intäkter's two pages a day belongs to: Zettle or Swish. A ZETTLE_FEE day booked before
// the per-day voucher is Zettle's.

import type { IncomeSource } from "@/lib/domain/types";

const INCOME_SOURCE_SLUGS = ["zettle", "swish"] as const;
export type IncomeSourceSlug = (typeof INCOME_SOURCE_SLUGS)[number];

export const isIncomeSourceSlug = (s: string): s is IncomeSourceSlug =>
  (INCOME_SOURCE_SLUGS as readonly string[]).includes(s);

/** The stored sources a page holds. */
export const sourcesOf = (slug: IncomeSourceSlug): IncomeSource[] =>
  slug === "zettle" ? ["ZETTLE", "ZETTLE_FEE"] : ["SWISH"];

/** The page a stored source belongs to. */
export const slugOf = (source: IncomeSource): IncomeSourceSlug =>
  source === "SWISH" ? "swish" : "zettle";

/** Where a day lives. */
export const incomeDayHref = (r: { id: string; source: IncomeSource }) =>
  `/income/${slugOf(r.source)}/${r.id}`;

/** Where a source's list lives. */
export const incomeListHref = (slug: IncomeSourceSlug, tab?: string) =>
  `/income/${slug}${tab ? `?tab=${tab}` : ""}`;
