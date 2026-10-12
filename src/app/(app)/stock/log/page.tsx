import { requirePage } from "@/lib/server/current-user";
import { canViewStock } from "@/lib/domain/permissions";
import { getStockLevels, getStockLog } from "@/lib/data/stock";
import type { StockEntryKind } from "@/lib/domain/types";
import StockLogClient from "./log-client";

export default async function StockLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePage(canViewStock);
  const params = await searchParams;
  const one = (k: string) => {
    const v = params[k];
    return typeof v === "string" && v !== "" ? v : undefined;
  };
  /** A filter that takes several values, comma-separated in one parameter. */
  const many = (k: string) => (one(k) ?? "").split(",").filter(Boolean);

  const filter = {
    productIds: many("product"),
    kinds: many("kind") as StockEntryKind[],
    eventId: one("event"),
    from: one("from"),
    to: one("to"),
  };
  const [log, products] = await Promise.all([
    getStockLog({ ...filter, take: 500 }),
    // Levels rather than plain products so the filter's picker can name what is
    // on the shelf beside each one.
    getStockLevels(),
  ]);
  return <StockLogClient log={log} products={products} filter={filter} />;
}
