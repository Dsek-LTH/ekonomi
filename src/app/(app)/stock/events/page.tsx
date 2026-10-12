import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockEvents } from "@/lib/data/stock";
import EventsClient from "./events-client";

export default async function StockEventsPage() {
  const user = await requirePage(canViewStock);
  const events = await getStockEvents(200);
  return <EventsClient events={events} canManage={canManageStock(user.capabilities)} />;
}
