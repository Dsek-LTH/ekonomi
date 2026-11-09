import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockChanges, getStockLevels, getStockEvent } from "@/lib/data/stock";
import EventClient from "./event-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockEvent");

export default async function StockEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canViewStock);
  const [event, products, changes] = await Promise.all([
    getStockEvent(id),
    // Levels, not just products: the sheet offers bottles to take off the shelf.
    getStockLevels(),
    // The night in order: how the figures got where the sheet shows them.
    getStockChanges({ eventId: id, take: 100 }),
  ]);
  if (!event) notFound();
  return (
    <EventClient
      event={event}
      products={products}
      changes={changes}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
