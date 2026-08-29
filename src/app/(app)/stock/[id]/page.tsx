import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getProductCellar, getProductOccasions, getStockLevels } from "@/lib/data/stock";
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
  const [levels, occasions, cellar] = await Promise.all([
    getStockLevels(),
    getProductOccasions(id),
    getProductCellar(id),
  ]);

  const product = levels.find((p) => p.id === id);
  if (!product) notFound();

  return (
    <StockProductClient
      product={product}
      occasions={occasions}
      cellar={cellar}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
