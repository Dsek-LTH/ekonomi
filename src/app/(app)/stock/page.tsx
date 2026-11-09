import { requirePage } from "@/lib/server/current-user";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getExpiryChecks, getStockLevels } from "@/lib/data/stock";
import { today } from "@/lib/domain/date";
import StockClient from "./stock-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stock");

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requirePage(canViewStock);
  const params = await searchParams;
  // In the URL so a "what did we hold at the end of April" view can be sent to someone.
  const raw = params.date;
  const asOf = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

  // Always as of today, whatever date the list is read at.
  const [levels, checks] = await Promise.all([getStockLevels(asOf), getExpiryChecks()]);
  return (
    <StockClient
      levels={levels}
      // A plain object: a Map does not cross the server boundary.
      checks={checks ? Object.fromEntries(checks) : {}}
      // No notice period chosen means nothing is watched. Said on the page so empty flags are not read as "nothing is due".
      expiryUnset={checks === null}
      asOf={asOf}
      // Settled on the server so both renders agree (a browser clock near midnight can be on another day).
      today={today()}
      canManage={canManageStock(user.capabilities)}
    />
  );
}
