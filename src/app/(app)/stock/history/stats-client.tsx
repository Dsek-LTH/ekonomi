"use client";

// The shelf as a period: what it was worth, what it is made of and what went through it, read off the same log as the list.
import { IconChart, IconList } from "@/components/ui/icons";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { HISTORY_PATH, historyHref, type HistoryView } from "./views";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DateInput, FieldGroup } from "@/components/ui/field";
import { MultiCombobox } from "@/components/ui/combobox";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Button } from "@/components/ui/button";
import { StockValueChart } from "@/components/stock/value-chart";
import { CATEGORIES } from "@/lib/domain/categories";
import { isWholeDate } from "@/lib/data/list-query";
import type { DrinkCategory } from "@/lib/domain/types";
import type { StockStats } from "@/lib/data/stock-stats";
import { DRINK_SERIES } from "@/lib/ui/chart-colors";
import { cn } from "@/lib/ui/utils";
import { formatNumber, formatOreKr } from "@/lib/ui/format";
import { isoDay } from "@/lib/domain/date";

/** Already litres, not millilitres: these come out of the stats query summed. */
const formatLitreCount = (litres: number) => formatNumber(litres, 0, 1);

export default function StockStatsClient({
  stats,
  from,
  to,
  today,
  categories,
  tags,
}: {
  stats: StockStats;
  from: string;
  to: string;
  /** The day the period runs to while nobody has picked one. */
  today: string;
  categories: DrinkCategory[];
  tags: string[];
}) {
  const t = useTranslations("stock");
  const router = useRouter();

  /** The dates as typed. A date is typed digit by digit, so the address is only touched when the value is a whole date or cleared (lib/data/list-query.ts). */
  const [dates, setDates] = useState({ from, to });
  // When the address changes by another route (Rensa, back) the text follows, adjusted during render (React's pattern for state mirroring a prop).
  const [asked, setAsked] = useState({ from, to });
  if (asked.from !== from || asked.to !== to) {
    setAsked({ from, to });
    setDates({ from, to });
  }

  function typeDate(field: "from" | "to", value: string) {
    setDates((d) => ({ ...d, [field]: value }));
    if (value === "" || isWholeDate(value)) ask({ [field]: value });
  }

  /** The periods worth a button, counted back from today ("the last six months") rather than from a calendar boundary. "Allt" is both fields empty. */
  const back = (months: number, days = 0): string => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    d.setUTCDate(d.getUTCDate() - days);
    return isoDay(d);
  };
  const ranges = [
    { key: "week", from: back(0, 6) },
    { key: "month", from: back(1) },
    { key: "halfYear", from: back(6) },
    { key: "year", from: back(12) },
    { key: "all", from: "" },
  ];
  // Lit when its period is the one shown; a hand-typed date lights none.
  const current = to && to !== today ? "" : (ranges.find((r) => r.from === from)?.key ?? "");

  /** Every filter is a parameter, so changing one is a navigation. Empty means absent. */
  function ask(next: Partial<{ from: string; to: string; cats: string[]; tags: string[] }>) {
    const now = { from, to, cats: categories as string[], tags, ...next };
    const p = new URLSearchParams({ view: "stats" });
    if (now.from) p.set("from", now.from);
    if (now.to && now.to !== today) p.set("to", now.to);
    if (now.cats.length) p.set("cats", now.cats.join(","));
    if (now.tags.length) p.set("tags", now.tags.join(","));
    router.push(`${HISTORY_PATH}?${p.toString()}`);
  }

  const shown = stats.holdings.reduce((sum, h) => sum + h.valueOre, 0);
  const narrowed = categories.length > 0 || tags.length > 0;
  const filtering = narrowed || Boolean(from) || Boolean(to);
  const flow = stats.flow;

  const tiles = [
    { key: "purchased", value: formatOreKr(flow.purchasedOre), tone: "" },
    { key: "consumed", value: formatOreKr(-flow.consumedOre), tone: "text-muted" },
    {
      key: "wasted",
      value: formatOreKr(-flow.wastedOre),
      tone: flow.wastedOre > 0 ? "text-warning" : "",
    },
    // Negative means the shelf held less than the log said, which nothing else on this card accounts for.
    {
      key: "adjusted",
      value: formatOreKr(flow.adjustmentOre),
      tone: flow.adjustmentOre < 0 ? "text-warning" : "",
    },
  ];

  return (
    <PageShell
      title={t("stats.title")}
      width="wide"
      // The other view of the same history, same period (../history/views.ts).
      views={{
        label: t("history.viewLabel"),
        value: "stats",
        options: [
          { value: "movements", label: t("history.movements"), icon: IconList },
          { value: "stats", label: t("history.stats"), icon: IconChart },
        ],
        onChange: (v) => router.push(historyHref(v as HistoryView, from, to)),
      }}
    >
      <div className="space-y-5">
        <Card>
          <CardBody className="space-y-3">
            <FieldGroup label={t("stats.period")}>
              <SegmentedControl
                size="sm"
                options={ranges.map((r) => ({
                  value: r.key,
                  label: t(`stats.range.${r.key}`),
                }))}
                value={current}
                onChange={(key) => {
                  const range = ranges.find((r) => r.key === key);
                  if (range) ask({ from: range.from, to: "" });
                }}
              />
            </FieldGroup>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <FieldGroup label={t("stats.from")}>
                <DateInput
                  size="sm"
                  value={dates.from}
                  onChange={(e) => typeDate("from", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label={t("stats.to")}>
                {/* Today when nobody has said otherwise, not put in the address. */}
                <DateInput
                  size="sm"
                  value={dates.to || today}
                  onChange={(e) => typeDate("to", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup label={t("filterCategory")}>
                <MultiCombobox
                  size="sm"
                  options={CATEGORIES.map((c) => ({
                    value: c,
                    label: t(`category.${c}`),
                  }))}
                  values={categories}
                  onChange={(cats) => ask({ cats })}
                  placeholder={t("filterCategory")}
                  aria-label={t("filterCategory")}
                />
              </FieldGroup>
              <FieldGroup label={t("filterTag")}>
                <MultiCombobox
                  size="sm"
                  options={stats.tags.map((tag) => ({ value: tag, label: tag }))}
                  values={tags}
                  onChange={(next) => ask({ tags: next })}
                  placeholder={t("filterTag")}
                  emptyText={t("products.field.tagsNone")}
                  aria-label={t("filterTag")}
                />
              </FieldGroup>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={t("stats.valueTitle")}
            subtitle={
              narrowed
                ? t("stats.valueOfWhole", {
                    shown: formatOreKr(shown),
                    whole: formatOreKr(stats.wholeShelfOre),
                  })
                : t("stats.valueNow", { value: formatOreKr(shown) })
            }
            action={
              filtering ? (
                <Button variant="ghost" size="sm" onClick={() => router.push(historyHref("stats"))}>
                  {t("stats.clear")}
                </Button>
              ) : undefined
            }
          />
          <CardBody>
            <StockValueChart points={stats.points} />
          </CardBody>
        </Card>

        {/* `minmax(0,1fr)`: an implicit `auto` track is never narrower than its card's min-content. See the product page. */}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title={t("stats.flowTitle")} subtitle={t("stats.flowHint")} />
            <CardBody className="grid grid-cols-2 gap-4">
              {tiles.map((tile) => (
                // `min-w-0`: a grid track is as wide as its content, so a six-figure `text-xl` sum would push the card off a phone.
                <div key={tile.key} className="min-w-0">
                  <p className="text-xs text-muted">{t(`stats.flow.${tile.key}`)}</p>
                  <p
                    className={cn("mt-1 text-lg font-semibold tabular-nums sm:text-xl", tile.tone)}
                  >
                    {tile.value}
                  </p>
                </div>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t("stats.mixTitle")} subtitle={t("stats.mixHint")} />
            {/* On a phone the three figures (240px of fixed columns) do not fit a 300px card, so the row wraps with the figures on their own line. */}
            <CardBody className="space-y-2">
              {stats.holdings.map((h) => {
                const share = shown > 0 ? (h.valueOre / shown) * 100 : 0;
                return (
                  <div key={h.category} className="flex flex-wrap items-center gap-x-3 text-sm">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-mark"
                      style={{ background: DRINK_SERIES[h.category] }}
                    />
                    <span className="min-w-[7rem] flex-1 truncate">
                      {t(`category.${h.category}`)}
                    </span>
                    <span className="ml-auto flex shrink-0 items-baseline gap-3">
                      <span className="w-20 text-right tabular-nums text-muted">
                        {h.litres == null
                          ? "-"
                          : t("litres", {
                              litres: formatLitreCount(h.litres),
                            })}
                      </span>
                      <span className="w-24 text-right font-medium tabular-nums">
                        {formatOreKr(h.valueOre)}
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-muted">
                        {share.toFixed(0)} %
                      </span>
                    </span>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader title={t("stats.moversTitle")} subtitle={t("stats.moversHint")} />
          <CardBody className="space-y-2">
            {stats.movers.length === 0 ? (
              <p className="text-sm text-muted">{t("stats.nothing")}</p>
            ) : (
              // Wraps on a phone: a product name truncated to "Norr…" says nothing.
              stats.movers.map((m) => (
                <div key={m.id} className="flex flex-wrap items-center gap-x-3 text-sm">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-mark"
                    style={{ background: DRINK_SERIES[m.category] }}
                  />
                  <Link
                    href={`/stock/${m.id}`}
                    className="min-w-[8rem] flex-1 truncate hover:underline"
                  >
                    {m.name}
                  </Link>
                  <span className="ml-auto flex shrink-0 items-baseline gap-3">
                    <span className="w-24 text-right tabular-nums text-muted">
                      {formatOreKr(m.outOre)}
                    </span>
                    <span className="w-24 text-right font-medium tabular-nums">
                      {formatOreKr(m.valueOre)}
                    </span>
                  </span>
                </div>
              ))
            )}
          </CardBody>
        </Card>
      </div>
    </PageShell>
  );
}
