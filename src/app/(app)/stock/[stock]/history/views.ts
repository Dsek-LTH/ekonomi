// Lagrets historik: the movements or the statistics, two pages over the same log, shown as page tabs under the title.
// The period (`from`, `to`) and the places are shared when switching view, since both views read them. Each view's
// own narrowing (products and kinds in one, types and tags in the other) is left behind.

import type { PageTabsProps } from "@/components/ui/page-tabs";
import { IconChart, IconList } from "@/components/ui/icons";

export type HistoryView = "movements" | "stats";

/** `base` is the stock's own history page, e.g. `/stock/alcohol/history` (see `useStock`). */
export function historyHref(
  base: string,
  view: HistoryView,
  from?: string,
  to?: string,
  places: string[] = [],
): string {
  const p = new URLSearchParams();
  if (view === "stats") p.set("view", "stats");
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (places.length) p.set("place", places.join(","));
  const q = p.toString();
  return q ? `${base}?${q}` : base;
}

/** The page tabs both views show, each carrying the period and places over. `labels` are the tabs' names and the strip's. */
export function historyPages(
  base: string,
  current: HistoryView,
  labels: { label: string; movements: string; stats: string },
  from?: string,
  to?: string,
  places: string[] = [],
): PageTabsProps {
  return {
    label: labels.label,
    value: current,
    options: (["movements", "stats"] as const).map((view) => ({
      value: view,
      label: labels[view],
      href: historyHref(base, view, from, to, places),
      icon: view === "movements" ? IconList : IconChart,
    })),
  };
}
