// Lagrets historik: the movements or the statistics, two views of one page over the same log.
// The period (`from`, `to`) is shared when switching view, each view's own narrowing is left behind.

export type HistoryView = "movements" | "stats";

/** `base` is the stock's own history page, e.g. `/stock/alcohol/history` (see `useStock`). */
export function historyHref(base: string, view: HistoryView, from?: string, to?: string): string {
  const p = new URLSearchParams();
  if (view === "stats") p.set("view", "stats");
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}
