import { requirePage } from "@/lib/server/current-user";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import StocktakeClient from "./stocktake-client";

// Gated on managing rather than viewing, like the delivery sheet beside it:
// the page is nothing but a way of writing to the log.
export default async function StocktakePage() {
  await requirePage(canManageStock);
  return (
    <StocktakeClient
      products={await getStockLevels()}
      // Settled on the server, so the two renders agree. See the delivery page.
      today={today()}
    />
  );
}
