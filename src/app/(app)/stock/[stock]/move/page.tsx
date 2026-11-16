import { notFound } from "next/navigation";
import { getMoveSheet } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import { canManageStock } from "@/lib/domain/permissions";
import { fiscalYearAround } from "@/lib/server/fiscal-year";
import { titled } from "@/lib/server/page-title";
import { requireStockPage } from "@/lib/server/stock-page";
import { STOCKS } from "@/lib/stock/stocks";
import MoveClient from "./move-client";

export const generateMetadata = titled("stockMove");

// Stock carried between storage and the stock's places: a fridge refilled, a committee taking what it needs for a
// shift and bringing back the rest. Open to whoever holds a place, through their Authentik groups.
export default async function StockMovePage({ params }: { params: Promise<{ stock: string }> }) {
  const { user, stock } = await requireStockPage(params, "move");
  if (!STOCKS[stock].usesPlaces) notFound();
  // Settled on the server so both renders agree.
  const day = today();
  const sheet = await getMoveSheet(
    stock,
    {
      id: user.id,
      stockPlaceIds: user.stockPlaceIds,
      keeps: canManageStock(user.capabilities, stock),
    },
    await fiscalYearAround(day),
  );
  return <MoveClient {...sheet} today={day} />;
}
