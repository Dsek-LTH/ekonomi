import { redirect } from "next/navigation";

import {
  canAccessSettings,
  canBookkeep,
  canBookStock,
  canUnexport,
} from "@/lib/domain/permissions";
import { today } from "@/lib/domain/date";
import { requireStockPage } from "@/lib/server/stock-page";
import { titled } from "@/lib/server/page-title";
import { getReconciliation, getSentVouchers, loadPosting } from "@/lib/server/stock-posting";
import { stockPath } from "@/lib/stock/stocks";

import BookkeepingClient from "./bookkeeping-client";

export const generateMetadata = titled("stockVouchers");

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

// A stock's value in the books. Nothing goes to Fortnox by itself: a bookkeeper picks a date, and every day not yet
// sent up to it goes as one voucher. The days waiting are computed from the log each time. See docs/stock.md.
export default async function StockBookkeepingPage({
  params,
  searchParams,
}: {
  params: Promise<{ stock: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, stock } = await requireStockPage(params, "enter");
  if (!canBookStock(user.capabilities)) redirect(stockPath(stock));

  // The date the voucher would run through, in the address so the preview is the server's own figure.
  const raw = (await searchParams).through;
  const asked = isDate(raw) ? raw : undefined;

  const first = await loadPosting(stock);
  // With no date asked for, the preview runs through the last day waiting, which is "send everything".
  const through = asked ?? first.days.at(-1)?.date;
  const [posting, sent, reconciliation] = await Promise.all([
    through ? loadPosting(stock, undefined, through) : first,
    getSentVouchers(stock),
    getReconciliation(stock),
  ]);

  return (
    <BookkeepingClient
      stock={stock}
      days={posting.days}
      voucher={posting.voucher}
      voucherRefusal={posting.voucherRefusal}
      through={through ?? ""}
      sentThrough={posting.sentThrough}
      corrections={posting.corrections}
      inFlight={posting.inFlight}
      gaps={posting.gaps}
      startsOn={posting.startsOn}
      sent={sent}
      reconciliation={reconciliation}
      today={today()}
      canExport={canBookkeep(user.capabilities)}
      canUndo={canUnexport(user.capabilities)}
      canSetUp={canAccessSettings(user.capabilities)}
    />
  );
}
