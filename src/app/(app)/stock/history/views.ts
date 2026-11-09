// Lagrets historik: the movements or the statistics, two views of one page over the same log.
// The period (`from`, `to`) is shared when switching view, each view's own narrowing is left behind.

export type HistoryView = "movements" | "stats";

export const HISTORY_PATH = "/stock/history";

export function historyHref(view: HistoryView, from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (view === "stats") p.set("view", "stats");
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const q = p.toString();
  return q ? `${HISTORY_PATH}?${q}` : HISTORY_PATH;
}
