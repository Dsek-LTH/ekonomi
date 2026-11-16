import { requireStockPage } from "@/lib/server/stock-page";
import { canManageStock } from "@/lib/domain/permissions";
import { getExpiryChecks, getPlaceSummary, getStockLevels } from "@/lib/data/stock";
import { fiscalYearWhere, getFiscalYear } from "@/lib/server/fiscal-year";
import { STOCKS } from "@/lib/stock/stocks";
import { today } from "@/lib/domain/date";
import StockClient from "./stock-client";
import { titled } from "@/lib/server/page-title";

export const generateMetadata = titled("stock");

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ stock: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, stock } = await requireStockPage(params);
  const query = await searchParams;
  // In the URL so a "what did we hold at the end of April" view can be sent to someone.
  const raw = query.date;
  const asOf = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;

  // Always as of today, whatever date the list is read at.
  // What each place has been charged, over the räkenskapsår picked in the header.
  const year = STOCKS[stock].usesPlaces ? await getFiscalYear() : null;
  const [levels, checks, places] = await Promise.all([
    getStockLevels(stock, asOf),
    getExpiryChecks(stock),
    STOCKS[stock].usesPlaces
      ? getPlaceSummary(stock, year ? fiscalYearWhere(year) : null)
      : Promise.resolve([]),
  ]);
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
      canManage={canManageStock(user.capabilities, stock)}
      places={places}
      year={year ? { from: year.fromDate, to: year.toDate } : undefined}
    />
  );
}
