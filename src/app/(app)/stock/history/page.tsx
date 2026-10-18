import { requirePage } from "@/lib/server/current-user";
import { canViewStock } from "@/lib/domain/permissions";
import { getStockLevels, getStockLog } from "@/lib/data/stock";
import { getStockStats } from "@/lib/data/stock-stats";
import { today } from "@/lib/domain/date";
import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory, StockEntryKind } from "@/lib/domain/types";
import StockLogClient from "../log/log-client";
import StockStatsClient from "../stats/stats-client";

// The stock's history, in one of two views (see ./views.ts): the movements, or
// the statistics. Everything about either lives in the address, so a view of
// a period can be sent to somebody, and the back button walks the questions.

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** A comma-separated parameter, which is how this app spells a list in a URL. */
const list = (v: string | string[] | undefined): string[] =>
  first(v)?.split(",").filter(Boolean) ?? [];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function StockHistoryPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requirePage(canViewStock);
  const sp = await searchParams;
  const from = isDate(first(sp.from)) ? (first(sp.from) as string) : undefined;
  const to = isDate(first(sp.to)) ? (first(sp.to) as string) : undefined;

  if (first(sp.view) === "stats") {
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
        today={today()}
        categories={categories}
        tags={tags}
      />
    );
  }

  const filter = {
    productIds: list(sp.product),
    kinds: list(sp.kind) as StockEntryKind[],
    eventId: first(sp.event) || undefined,
    from,
    to,
  };
  const [log, products] = await Promise.all([
    getStockLog({ ...filter, take: 500 }),
    getStockLevels(),
  ]);
  return <StockLogClient log={log} products={products} filter={filter} />;
}
