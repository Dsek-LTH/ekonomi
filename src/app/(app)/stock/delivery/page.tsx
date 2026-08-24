import { requirePage } from "@/lib/server/current-user";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import DeliveryClient from "./delivery-client";

// Gated on managing rather than viewing, unlike the rest of the stock screens:
// this page is nothing but a way of writing to the log, so somebody who may
// only look at it has no version of it to be shown.
export default async function StockDeliveryPage() {
  await requirePage(canManageStock);
  return (
    <DeliveryClient
      products={await getStockLevels()}
      // Settled on the server, so the two renders agree. Computed in the
      // browser it is whatever that machine's clock says, which near midnight
      // is a different day from the one the markup was built with.
      today={today()}
    />
  );
}
