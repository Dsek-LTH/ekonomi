import { notFound } from "next/navigation";
import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockChanges, getStockLevels, getStockEvent } from "@/lib/data/stock";
import EventClient from "./event-client";

export default async function StockEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(canViewStock);
  const [event, products, changes] = await Promise.all([
    getStockEvent(id),
    // Levels, not just products: the sheet has to know what is on the shelf
    // before it can offer bottles to take off it.
    getStockLevels(),
    // The night in order, which is the reading the sheet cannot give: the sheet
    // shows where the figures ended up, this shows how they got there.
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
