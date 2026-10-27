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

export default async function StockProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePage(canViewStock);

  // The shelf comes from the same loader the list uses rather than a query of
  // its own: one projection of the log, so a product cannot read one way here
  // and another there.
  // Two histories, because the product has been through two different sorts of
  // thing: nights it went out to, and what was done to it in the cellar. See
  // the data layer for why that is the split rather than movements-versus-edits.
  const [levels, events, cellar, movements, checks] = await Promise.all([
    getStockLevels(),
    getProductEvents(id),
    getProductCellar(id),
    // Not derivable from the two histories above: one is capped at 60 rows and
    // the other only covers nights. What the delete confirmation has to name is
    // every row that would go, so it is counted outright.
    getProductMovementCount(id),
    // The whole schedule for this product, not just what is owed: the page
    // lists what is coming as well, which is what makes it something to work
    // through rather than a second copy of the overview's flag.
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
      // What the rest of the shelf calls things, for the edit dialog's tag
      // picker. Off the levels this page already has rather than a query of
      // its own.
      knownTags={tagsInUse(levels)}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
