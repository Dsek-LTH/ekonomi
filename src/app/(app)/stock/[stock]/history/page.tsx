import { requireStockPage } from "@/lib/server/stock-page";
import { getStockLevels, getStockLog, getStockPlaces } from "@/lib/data/stock";
import { getStockStats } from "@/lib/data/stock-stats";
import { today } from "@/lib/domain/date";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import type { StockEntryKind } from "@/lib/domain/types";
import StockLogClient from "./log-client";
import StockStatsClient from "./stats-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockHistory");

// The stock's history in one of two views (see ./views.ts), all in the address so a view can be sent on.

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const list = (v: string | string[] | undefined): string[] =>
  first(v)?.split(",").filter(Boolean) ?? [];
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function StockHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ stock: string }>;
  searchParams: Promise<Params>;
}) {
  const { user, stock } = await requireStockPage(params);
  const sp = await searchParams;
  const from = isDate(first(sp.from)) ? (first(sp.from) as string) : undefined;
  const to = isDate(first(sp.to)) ? (first(sp.to) as string) : undefined;

  if (first(sp.view) === "stats") {
    const groups = list(sp.groups);
    const tags = list(sp.tags);
    const stats = await getStockStats({ stock, from, to, groups, tags });
    return (
      <StockStatsClient
        stats={stats}
        from={from ?? ""}
        to={to ?? ""}
        today={today()}
        groups={groups}
        tags={tags}
      />
    );
  }

  const filter = {
    stock,
    productIds: list(sp.product),
    kinds: list(sp.kind) as StockEntryKind[],
    eventId: first(sp.event) || undefined,
    placeIds: list(sp.place),
    from,
    to,
  };
  const [log, products, places] = await Promise.all([
    getStockLog({ ...filter, take: 500 }),
    getStockLevels(stock),
    getStockPlaces(stock),
  ]);
  return (
    <StockLogClient
      log={log}
      products={products}
      places={places}
      boardLinked={canViewBookkeeping(user.capabilities)}
      filter={filter}
    />
  );
}
