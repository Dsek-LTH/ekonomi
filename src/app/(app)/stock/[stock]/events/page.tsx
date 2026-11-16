import { requireStockPage } from "@/lib/server/stock-page";
import { notFound } from "next/navigation";
import { STOCKS } from "@/lib/stock/stocks";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockEvents } from "@/lib/data/stock";
import EventsClient from "./events-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockEvents");

export default async function StockEventsPage({ params }: { params: Promise<{ stock: string }> }) {
  const { user, stock } = await requireStockPage(params);
  // Nights are how the bar's stock leaves. A stock without them has no such page.
  if (!STOCKS[stock].usesEvents) notFound();
  const events = await getStockEvents(stock, 200);
  return <EventsClient events={events} canManage={canManageStock(user.capabilities, stock)} />;
}
