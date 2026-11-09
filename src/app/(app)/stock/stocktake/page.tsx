import { requirePage } from "@/lib/server/current-user";
import { canManageStock } from "@/lib/domain/permissions";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import StocktakeClient from "./stocktake-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stocktake");

// Gated on managing, like the delivery sheet.
export default async function StocktakePage() {
  await requirePage(canManageStock);
  return (
    <StocktakeClient
      products={await getStockLevels()}
      // Settled on the server so both renders agree.
      today={today()}
    />
  );
}
