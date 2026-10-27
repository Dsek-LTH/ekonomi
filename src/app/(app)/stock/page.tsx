import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getExpiryChecks, getStockLevels } from "@/lib/data/stock";
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

  // Which products want somebody to go and read a crate. Always as of today,
  // whatever date the list is being read at: "what did we hold in April" is a
  // question about the past, and a check is a thing to do this week.
  const [levels, checks] = await Promise.all([getStockLevels(asOf), getExpiryChecks()]);
  return (
    <StockClient
      levels={levels}
      // A plain object rather than the Map the loader returns: this crosses the
      // server boundary, and a Map does not.
      checks={checks ? Object.fromEntries(checks) : {}}
      // No notice period chosen, so nothing is being watched. Said on the
      // page, so an empty column of flags is not read as "nothing is due".
      expiryUnset={checks === null}
      asOf={asOf}
      // Settled on the server, so the two renders agree. Computed in the
      // browser it is whatever that machine's clock says, which near midnight
      // is a different day from the one the markup was built with.
      today={today()}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
