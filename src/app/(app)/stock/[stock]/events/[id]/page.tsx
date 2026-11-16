import { notFound } from "next/navigation";
import { requireStockPage } from "@/lib/server/stock-page";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockChanges, getStockLevels, getStockEvent } from "@/lib/data/stock";
import EventClient from "./event-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockEvent");

export default async function StockEventPage({
  params,
}: {
  params: Promise<{ stock: string; id: string }>;
}) {
  const { id } = await params;
  const { user, stock } = await requireStockPage(params);
  const [event, products, changes] = await Promise.all([
    getStockEvent(id),
    // Levels, not just products: the sheet offers bottles to take off the shelf.
    getStockLevels(stock),
    // The night in order: how the figures got where the sheet shows them.
    getStockChanges({ eventId: id, take: 100 }),
  ]);
  // A night of the other stock is not this stock's page.
  if (!event || event.stock !== stock) notFound();
  return (
    <EventClient
      event={event}
      products={products}
      changes={changes}
      canManage={canManageStock(user.capabilities, stock)}
    />
  );
}
