import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import {
  getProductCellar,
  getProductEvents,
  getProductChecks,
  getProductMovementCount,
  getStockLevels,
} from "@/lib/data/stock";
import { tagsInUse } from "@/lib/stock/tags";
import StockProductClient from "./product-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("product");

export default async function StockProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canViewStock);

  // From the same loader as the list, so a product reads the same in both.
  // Two histories: nights it went out to, and what was done to it in the cellar.
  const [levels, events, cellar, movements, checks] = await Promise.all([
    getStockLevels(),
    getProductEvents(id),
    getProductCellar(id),
    // Counted outright: the histories above are capped, and the delete confirmation must name every row that would go.
    getProductMovementCount(id),
    // The whole schedule, not just what is owed: the page lists what is coming too.
    getProductChecks(id),
  ]);

  const product = levels.find((p) => p.id === id);
  if (!product) notFound();

  return (
    <StockProductClient
      product={product}
      events={events}
      cellar={cellar}
      movements={movements}
      checks={checks ?? []}
      expiryUnset={checks === null}
      // Tags the rest of the shelf uses, for the edit dialog's tag picker.
      knownTags={tagsInUse(levels)}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
