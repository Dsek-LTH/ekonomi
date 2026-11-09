import { requirePage } from "@/lib/server/current-user";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import DeliveryClient from "./delivery-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stockDelivery");

// Gated on managing, unlike the other stock screens: the page only writes to the log.
export default async function StockDeliveryPage() {
  await requirePage(canManageStock);
  return (
    <DeliveryClient
      products={await getStockLevels()}
      // Settled on the server so both renders agree.
      today={today()}
    />
  );
}
