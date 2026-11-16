import { requireStockPage } from "@/lib/server/stock-page";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import StocktakeClient from "./stocktake-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stocktake");

// Gated on managing, like the delivery sheet.
export default async function StocktakePage({ params }: { params: Promise<{ stock: string }> }) {
  const { stock } = await requireStockPage(params, "manage");
  return (
    <StocktakeClient
      products={await getStockLevels(stock)}
      // Settled on the server so both renders agree.
      today={today()}
    />
  );
}
