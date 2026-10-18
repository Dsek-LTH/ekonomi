import { permanentRedirect } from "next/navigation";
import { HISTORY_PATH } from "../history/views";

// The statistics are the stats view of the stock's history now (see
// ../history/views.ts). Kept as a redirect, with its period and filters, so a
// link to them still lands on them.
export default async function StockStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams({ view: "stats" });
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  permanentRedirect(`${HISTORY_PATH}?${q}`);
}
