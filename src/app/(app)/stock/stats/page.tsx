import { requirePage } from "@/lib/server/current-user";
import { today } from "@/lib/domain/date";
import { canViewStock } from "@/lib/domain/permissions";
import { getStockStats } from "@/lib/data/stock-stats";
import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory } from "@/lib/domain/types";
import StockStatsClient from "./stats-client";

/** A comma-separated parameter, which is how this app spells a list in a URL.
 *  See lib/data/list-query.ts. */
const list = (v: string | string[] | undefined): string[] =>
  (Array.isArray(v) ? v[0] : v)?.split(",").filter(Boolean) ?? [];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * The period lives in the address, like every other list on the site.
 *
 * So a figure somebody is looking at can be sent to somebody else, and so the
 * back button walks the questions asked rather than dropping out of the page.
 */
export default async function StockStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage(canViewStock);
  const sp = await searchParams;

  const from = isDate(sp.from) ? sp.from : undefined;
  const to = isDate(sp.to) ? sp.to : undefined;
  const categories = list(sp.cats).filter((c): c is DrinkCategory =>
    (CATEGORIES as string[]).includes(c),
  );
  const tags = list(sp.tags);

  const stats = await getStockStats({ from, to, categories, tags });

  return (
    <StockStatsClient
      stats={stats}
      from={from ?? ""}
      to={to ?? ""}
      // The day the figures run to when nobody has said otherwise. Decided here
      // rather than in the browser: a phone in another timezone would otherwise
      // draw a different last point than the server computed. See the stock
      // list, which settles its own as-of date the same way.
      today={today()}
      categories={categories}
      tags={tags}
    />
  );
}
