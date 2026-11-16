"use client";

// What each place has been charged this räkenskapsår: taken less brought back, in units and at cost. A row opens
// the place's movements in the history.
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useStock } from "@/components/stock/stock-context";
import { Card, CardHeader } from "@/components/ui/card";
import type { PlaceSummaryDto } from "@/lib/data/stock";
import { formatOreKr } from "@/lib/ui/format";

export function PlaceSummary({
  places,
  from,
  to,
}: {
  places: PlaceSummaryDto[];
  /** The räkenskapsår's bounds, for the history link. Absent before Fortnox has been synced. */
  from?: string;
  to?: string;
}) {
  const t = useTranslations("stock.places");
  const { href } = useStock();
  if (places.length === 0) return null;

  const history = (id: string) => {
    const q = new URLSearchParams({ place: id, ...(from && { from }), ...(to && { to }) });
    return href(`/history?${q}`);
  };

  return (
    <Card>
      <CardHeader title={t("title")} subtitle={t("hint")} />
      <ul className="divide-y divide-border border-t border-border">
        {places.map((p) => (
          <li key={p.id}>
            <Link
              href={history(p.id)}
              className="flex items-center gap-3 px-inset py-2.5 text-sm hover:bg-hover"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
              <span className="hidden text-muted tabular-nums sm:inline">
                {p.costCenterCode ?? t("defaultCostCenter")}
              </span>
              <span className="w-16 text-right tabular-nums text-muted">
                {t("units", { units: p.units })}
              </span>
              <span className="w-24 text-right font-medium tabular-nums">
                {formatOreKr(p.valueOre)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
