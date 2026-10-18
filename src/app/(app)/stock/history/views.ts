// Lagrets historik: what happened to the stock over a period, as the movements
// one by one or as the sums and charts of them. Two views of one page, because
// they answer one question for the same people, the treasury looking back, and
// read the same log. They were two tabs, the log and the statistics.
//
// The period is shared: switching view keeps `from` and `to`, so "the value
// fell in October" goes straight to the movements that made it fall. Each
// view's own narrowing (products and kinds for the movements, drink types and
// tags for the sums) is its own and is left behind.

export type HistoryView = "movements" | "stats";

export const HISTORY_PATH = "/stock/history";

/** Where a view of the history is, for the given period. */
export function historyHref(view: HistoryView, from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (view === "stats") p.set("view", "stats");
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const q = p.toString();
  return q ? `${HISTORY_PATH}?${q}` : HISTORY_PATH;
}
