"use client";

// The shelf as a period: what it was worth, what it is made of and what went through it, read off the same log as the list.
// Laid out like Utfall & rapporter: what the figures are of in a panel on the left (the same period picker, then type,
// tag and place), the figures beside it. On a phone the panel stacks above.
import { useStock } from "@/components/stock/stock-context";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";

import { PageShell } from "@/components/page-shell";
import { historyHref, historyPages } from "./views";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MultiCombobox } from "@/components/ui/combobox";
import { Button, PlainButton } from "@/components/ui/button";
import { PanelField, PanelRow, PeriodRow } from "@/components/report-panel";
import { periodOptions, type PeriodYear } from "@/lib/ui/period";
import { StockValueChart } from "@/components/stock/value-chart";
import type { PlaceTotals, StockStats } from "@/lib/data/stock-stats";
import { groupColor } from "@/lib/ui/chart-colors";
import { cn } from "@/lib/ui/utils";
import { formatNumber, formatOreKr } from "@/lib/ui/format";

/** Already litres, not millilitres: these come out of the stats query summed. */
const formatLitreCount = (litres: number) => formatNumber(litres, 0, 1);

export default function StockStatsClient({
  stats,
  from,
  to,
  year,
  groups,
  tags,
  places,
}: {
  stats: StockStats;
  /** The period shown, as the server settled it: the header's räkenskapsår while nobody has picked one. */
  from: string;
  to: string;
  /** The header's räkenskapsår, which the period picker names its periods in. Null before Fortnox has been synced. */
  year: PeriodYear | null;
  /** The product types the page is narrowed to, by group id. */
  groups: string[];
  tags: string[];
  /** The places the page is narrowed to, by id. */
  places: string[];
}) {
  const t = useTranslations("stock");
  const { href } = useStock();
  const history = href("/history");
  const router = useRouter();

  const locale = useLocale();
  const tPeriod = useTranslations("common.period");
  // The reader typed a date: the picker says "Anpassat intervall" even where the dates happen to match a month.
  const [custom, setCustom] = useState(false);

  /** Every filter is a parameter, so changing one is a navigation. Empty means absent. */
  function ask(
    next: Partial<{ from: string; to: string; groups: string[]; tags: string[]; places: string[] }>,
  ) {
    const now = { from, to, groups, tags, places, ...next };
    const p = new URLSearchParams({ view: "stats" });
    // Always both ends: the movements tab reads an absent date as "no limit", not as the year.
    if (now.from) p.set("from", now.from);
    if (now.to) p.set("to", now.to);
    if (now.groups.length) p.set("groups", now.groups.join(","));
    if (now.tags.length) p.set("tags", now.tags.join(","));
    if (now.places.length) p.set("place", now.places.join(","));
    router.push(`${history}?${p.toString()}`);
  }

  /** The stock's product types as the charts draw them: named, and coloured by their place in the list. */
  const series = stats.groups.map((g, i) => ({ id: g.id, name: g.name, color: groupColor(g, i) }));
  const byId = new Map(series.map((s) => [s.id, s]));

  const shown = stats.holdings.reduce((sum, h) => sum + h.valueOre, 0);
  const narrowed = groups.length > 0 || tags.length > 0;
  // The period is not a filter: Rensa keeps it.
  const filtering = narrowed || places.length > 0;

  const choice = year
    ? periodOptions(
        year,
        { from, to, custom },
        { wholeYear: tPeriod("wholeYear"), custom: tPeriod("custom"), locale },
      )
    : null;
  const period = choice
    ? {
        options: choice.options,
        value: choice.value,
        onPick: (v: string) => {
          const range = choice.rangeOf(v);
          if (!range) {
            setCustom(true);
            return;
          }
          setCustom(false);
          ask(range);
        },
        onManual: () => setCustom(true),
      }
    : undefined;
  const flow = stats.flow;
  const placeFlow = stats.placeFlow;

  // Narrowed to places, the period is what they took: nothing was bought or spilled at a place.
  const tiles = placeFlow
    ? [
        { key: "taken", value: formatOreKr(placeFlow.taken.valueOre), tone: "" },
        { key: "returned", value: formatOreKr(placeFlow.returned.valueOre), tone: "text-muted" },
        {
          key: "net",
          value: formatOreKr(placeFlow.taken.valueOre - placeFlow.returned.valueOre),
          tone: "",
        },
      ]
    : [
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
      title={t("history.title")}
      width="wide"
      // The other page over the same history, same period and places (./views.ts).
      pages={historyPages(
        history,
        "stats",
        {
          label: t("history.viewLabel"),
          movements: t("history.movements"),
          stats: t("history.stats"),
        },
        from,
        to,
        places,
      )}
    >
      <div className="space-y-5 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start lg:gap-6 lg:space-y-0">
        {/* Under the sticky section band, so the filters stay in view down the figures. */}
        <aside className="lg:sticky lg:top-[4.5rem]">
          <Card>
            <PeriodRow from={from || null} to={to || null} onRange={ask} period={period} />
            <PanelRow>
              <PanelField label={t("filterCategory")}>
                <MultiCombobox
                  size="sm"
                  options={series.map((s) => ({ value: s.id, label: s.name }))}
                  values={groups}
                  onChange={(picked) => ask({ groups: picked })}
                  placeholder={t("filterCategory")}
                  aria-label={t("filterCategory")}
                />
              </PanelField>
              <PanelField label={t("filterTag")}>
                <MultiCombobox
                  size="sm"
                  options={stats.tags.map((tag) => ({ value: tag, label: tag }))}
                  values={tags}
                  onChange={(next) => ask({ tags: next })}
                  placeholder={t("filterTag")}
                  emptyText={t("products.field.tagsNone")}
                  aria-label={t("filterTag")}
                />
              </PanelField>
            </PanelRow>
            {stats.places.length > 0 && (
              <PanelRow>
                <PanelField label={t("log.filter.place")}>
                  <MultiCombobox
                    size="sm"
                    options={stats.places.map((p) => ({ value: p.id, label: p.name }))}
                    values={places}
                    onChange={(next) => ask({ places: next })}
                    placeholder={t("log.filter.allPlaces")}
                    clearLabel={t("log.filter.allPlaces")}
                    aria-label={t("log.filter.place")}
                  />
                </PanelField>
              </PanelRow>
            )}
          </Card>
        </aside>

        <div className="min-w-0 space-y-5">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(historyHref(history, "stats", from, to))}
                  >
                    {t("stats.clear")}
                  </Button>
                ) : undefined
              }
            />
            <CardBody>
              <StockValueChart points={stats.points} series={series} />
            </CardBody>
          </Card>

          {/* `minmax(0,1fr)`: an implicit `auto` track is never narrower than its card's min-content. See the product page. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title={placeFlow ? t("stats.placeFlowTitle") : t("stats.flowTitle")} />
              <CardBody className="grid grid-cols-2 gap-4">
                {tiles.map((tile) => (
                  // `min-w-0`: a grid track is as wide as its content, so a six-figure `text-xl` sum would push the card off a phone.
                  <div key={tile.key} className="min-w-0">
                    <p className="text-xs text-muted">{t(`stats.flow.${tile.key}`)}</p>
                    <p
                      className={cn(
                        "mt-1 text-lg font-semibold tabular-nums sm:text-xl",
                        tile.tone,
                      )}
                    >
                      {tile.value}
                    </p>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title={t("stats.mixTitle")} />
              {/* On a phone the three figures (240px of fixed columns) do not fit a 300px card, so the row wraps with the figures on their own line. */}
              <CardBody className="space-y-2">
                {stats.holdings.map((h) => {
                  const share = shown > 0 ? (h.valueOre / shown) * 100 : 0;
                  return (
                    <div key={h.groupId} className="flex flex-wrap items-center gap-x-3 text-sm">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0 rounded-mark"
                        style={{ background: byId.get(h.groupId)?.color }}
                      />
                      <span className="min-w-[7rem] flex-1 truncate">
                        {byId.get(h.groupId)?.name}
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

          {stats.places.length > 0 && (
            <PlacesCard
              places={stats.places}
              selected={places}
              onPick={(id) => ask({ places: places.length === 1 && places[0] === id ? [] : [id] })}
            />
          )}

          <Card>
            <CardHeader title={placeFlow ? t("stats.placeMoversTitle") : t("stats.moversTitle")} />
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
                      style={{ background: byId.get(m.groupId)?.color }}
                    />
                    <Link
                      href={href(`/${m.id}`)}
                      className="min-w-[8rem] flex-1 truncate hover:underline"
                    >
                      {m.name}
                    </Link>
                    <span className="ml-auto flex shrink-0 items-baseline gap-3">
                      {placeFlow ? (
                        // What the places took: how many, and what that cost.
                        <>
                          <span className="w-24 text-right tabular-nums text-muted">
                            {t("places.units", { units: m.outUnits })}
                          </span>
                          <span className="w-24 text-right font-medium tabular-nums">
                            {formatOreKr(m.outOre)}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="w-24 text-right tabular-nums text-muted">
                            {formatOreKr(m.outOre)}
                          </span>
                          <span className="w-24 text-right font-medium tabular-nums">
                            {formatOreKr(m.valueOre)}
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}

/** Each place's net for the period: what it took less what it brought back. A row narrows the page to it. */
function PlacesCard({
  places,
  selected,
  onPick,
}: {
  places: PlaceTotals[];
  selected: string[];
  onPick: (id: string) => void;
}) {
  const t = useTranslations("stock");
  return (
    <Card>
      <CardHeader title={t("stats.placesTitle")} />
      <ul className="divide-y divide-divider border-t border-border">
        {places.map((p) => {
          const on = selected.includes(p.id);
          return (
            <li key={p.id}>
              <PlainButton
                aria-pressed={on}
                onClick={() => onPick(p.id)}
                className={cn(
                  "flex w-full items-center gap-3 px-inset py-2.5 text-left text-sm hover:bg-hover",
                  on && "bg-accent-soft hover:bg-accent-soft",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                <span className="hidden text-muted tabular-nums sm:inline">
                  {p.costCenterCode ?? t("places.defaultCostCenter")}
                </span>
                <span className="w-16 text-right tabular-nums text-muted">
                  {t("places.units", { units: p.taken.units - p.returned.units })}
                </span>
                <span className="w-24 text-right font-medium tabular-nums">
                  {formatOreKr(p.taken.valueOre - p.returned.valueOre)}
                </span>
              </PlainButton>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
