import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import StockClient from "./stock-client";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePage(canViewStock);
  const params = await searchParams;
  // In the URL rather than in state: "what did we hold at the end of April" is
  // a thing people send each other, and a date only this browser knows is one
  // they have to describe in words instead.
  const raw = params.date;
  const asOf = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

  const levels = await getStockLevels(asOf);
  return (
    <StockClient
      levels={levels}
      asOf={asOf}
      // Settled on the server, so the two renders agree. Computed in the
      // browser it is whatever that machine's clock says, which near midnight
      // is a different day from the one the markup was built with.
      today={today()}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
