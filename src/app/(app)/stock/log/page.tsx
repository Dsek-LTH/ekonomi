import { permanentRedirect } from "next/navigation";
import { HISTORY_PATH } from "../history/views";

// The log is the movements view of the stock's history now (see
// ../history/views.ts). Kept as a redirect rather than deleted, with its
// filters, because it is the page people sent each other links to.
export default async function StockLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  permanentRedirect(q.size ? `${HISTORY_PATH}?${q}` : HISTORY_PATH);
}
