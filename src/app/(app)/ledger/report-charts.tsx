"use client";

// The utfall as pictures. Five of them, each answering a question the table
// answers only if you already know what you are looking for.
//
//   Resultat per månad          how did the year run, and which months hurt
//   Ackumulerat resultat        are we on track, and since when
//   Kostnadsställen             who spent what, and who is over
//   Kostnader per kostnadsställe  when did each of them spend it
//   Vad pengarna gick till      what kind of cost the money was
//
// Hand-drawn, like the stock chart, and for the same reason: five series over
// twelve months does not need a charting library, and the app's own tokens are
// what make a chart look like the app. What the two do share is in
// lib/ui/chart-geometry (the coordinate space and the axis ladder) and
// lib/ui/chart-colors (the palette), because those are decisions and a decision
// copied is a decision that gets made differently the second time.
//
// The three that are a series over time are SVG. The two that are a ranked list
// of labelled things are HTML bars: their rows carry a name, a figure and
// sometimes a link, and laying text out is what HTML is for.
import { useId, useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyNote } from "@/components/ui/empty-state";
import { CHART_NEUTRAL, CHART_SERIES_COUNT, seriesColor } from "@/lib/ui/chart-colors";
import {
  axisTicks,
  fittedLabels,
  linearScale,
  plotOf,
  useChartGeometry,
  usePointerIndex,
} from "@/lib/ui/chart-geometry";
import { YGrid } from "@/components/ui/chart-axis";
import { formatSEK } from "@/lib/ui/format";
import { cn } from "@/lib/ui/utils";
import type { LedgerTrend, TrendCostCenter, TrendMonth } from "@/lib/ledger/trend";

// ── Money ───────────────────────────────────────────────────────────
//
// Two formatters, because an axis and a readout are asked different things. A
// readout is a figure somebody is checking, so it gets `formatSEK` with its öre
// like every other amount in the app. An axis is a ruler: it wants five short
// labels that fit in the gutter, and "262 728,00 kr" repeated five times is a
// wall of digits nobody reads.

const NUM = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const NUM1 = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 1 });

/**
 * One unit for a whole axis, chosen from its largest tick.
 *
 * Per axis and not per label: an axis that says "0, 5 000, 10 tkr" has changed
 * the question halfway up itself. The unit is repeated on every label instead
 * of stated once, because there is nowhere on these charts to state it once.
 */
function axisFormat(maxAbs: number): (v: number) => string {
  if (maxAbs >= 1_000_000) return (v) => (v === 0 ? "0" : `${NUM1.format(v / 1e6)} mkr`);
  if (maxAbs >= 20_000) return (v) => (v === 0 ? "0" : `${NUM1.format(v / 1000)} tkr`);
  return (v) => NUM.format(v);
}

/** A compact figure for a bar's own label, where the axis is not there to
 *  carry the unit. */
const money = (v: number) => `${NUM.format(v)} kr`;

// Money in and money out, named rather than taken off the rotation.
//
// The rotation is a list of colours for things that have no colour: the fourth
// cost centre is the fourth colour and means nothing by it. These two are the
// opposite, the one place in the app where a chart's hue is an argument: green
// came in, red went out, which is how every set of accounts anybody has read is
// coloured. Taking them by index would mean a reordering of the rotation, done
// for the separation of bands somewhere else entirely, silently repainted the
// section's costs amber.
//
// Safe as a red/green pair despite what globals.css says about those two,
// because they are also on opposite sides of the zero line and never touch. The
// axis is what carries the meaning; the colour agrees with it.
const INCOME = "var(--chart-3)";
const COST = "var(--chart-5)";

// ── A readout ───────────────────────────────────────────────────────

/** The little table that follows the pointer across a time chart. Positioned
 *  over the plot, on the side the crosshair is not. */
function Readout({
  side,
  title,
  rows,
}: {
  side: "left" | "right";
  title: string;
  rows: { label: string; value: string; color?: string; strong?: boolean }[];
}) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute top-2 w-48 rounded-xl border border-border bg-background p-2.5 shadow-[var(--shadow-pop)]",
        side === "left" ? "left-14" : "right-3",
      )}
    >
      <p className="mb-1.5 text-xs font-medium">{title}</p>
      <dl className="space-y-0.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className={cn(
              "flex items-center gap-1.5 text-[11px]",
              r.strong && "mt-1 border-t border-border pt-1 font-medium",
            )}
          >
            {r.color && (
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: r.color }}
              />
            )}
            <dt className="min-w-0 flex-1 truncate text-muted">{r.label}</dt>
            <dd className="tabular-nums">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A legend, under a chart. Always present where there is more than one series:
 *  colour alone is not a label, and five bands cannot be told apart by it. */
function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.key} className="flex items-center gap-1.5 text-xs text-muted">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </figcaption>
  );
}

/**
 * The pointer's month, in a chart's own coordinates.
 *
 * Shared because all three time charts track the same way and getting it subtly
 * different in each is how a crosshair ends up one band off in one of them.
 */
// ── 1. Resultat per månad ───────────────────────────────────────────

/**
 * Income above the line, costs below it, the result as a line across the top.
 *
 * Diverging rather than two bars side by side, because the axis is then doing
 * the work the colour would otherwise have to: money in goes up, money out goes
 * down, and the pair reads the same to someone who cannot tell the two hues
 * apart. It is also the only chart here where the green/red pairing is
 * deliberate rather than incidental.
 */
function MonthlyResult({
  months,
  monthLabel,
}: {
  months: TrendMonth[];
  monthLabel: (month: string, long?: boolean) => string;
}) {
  const t = useTranslations("ledger.charts");
  const geometry = useChartGeometry();
  const { W, H, PAD } = geometry;
  const plot = plotOf(geometry);
  const { ref, at, track, clear } = usePointerIndex(months.length, geometry);

  const axis = useMemo(() => {
    const hi = Math.max(0, ...months.map((m) => m.income), ...months.map((m) => m.result));
    const lo = Math.min(0, ...months.map((m) => m.costs), ...months.map((m) => m.result));
    return axisTicks(lo, hi);
  }, [months]);
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  const fmt = axisFormat(Math.max(Math.abs(lo), Math.abs(hi)));

  const y = linearScale(lo, hi, geometry);
  const band = plot.w / Math.max(1, months.length);
  // A gutter each side of the column, so neighbouring months do not touch.
  const barW = Math.max(2, band * 0.54);
  const cx = (i: number) => PAD.left + band * (i + 0.5);

  const zero = y(0);
  const labels = fittedLabels(months.length, band);
  const hovered = at == null ? null : months[at];

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={t("monthly.alt")}
          onPointerMove={track}
          onPointerLeave={clear}
        >
          <YGrid ticks={axis} y={y} geometry={geometry} format={fmt} />

          {/* The zero line is the one gridline that is a fact rather than a
              ruler mark, so it is drawn over the bars and in the text colour. */}
          {months.map((m, i) => (
            <g key={m.month}>
              {m.income > 0 && (
                <rect
                  x={cx(i) - barW / 2}
                  y={y(m.income)}
                  width={barW}
                  height={Math.max(1, zero - y(m.income))}
                  fill={INCOME}
                  rx={2}
                />
              )}
              {m.costs < 0 && (
                <rect
                  x={cx(i) - barW / 2}
                  y={zero}
                  width={barW}
                  height={Math.max(1, y(m.costs) - zero)}
                  fill={COST}
                  rx={2}
                />
              )}
            </g>
          ))}

          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={zero}
            y2={zero}
            className="stroke-foreground/45"
            strokeWidth={1}
          />

          {/* The result, over the two bars it is the difference of. */}
          <polyline
            points={months.map((m, i) => `${cx(i)},${y(m.result)}`).join(" ")}
            fill="none"
            className="stroke-foreground"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {months.map((m, i) => (
            <circle
              key={m.month}
              cx={cx(i)}
              cy={y(m.result)}
              r={2.5}
              className="fill-background stroke-foreground"
              strokeWidth={1.5}
            />
          ))}

          {labels.map((i) => (
            <text
              key={i}
              x={cx(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted text-[11px]"
            >
              {monthLabel(months[i].month)}
            </text>
          ))}

          {hovered && (
            <line
              x1={cx(at!)}
              x2={cx(at!)}
              y1={PAD.top}
              y2={PAD.top + plot.h}
              className="stroke-foreground/40"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {hovered && (
          <Readout
            side={at! > months.length / 2 ? "left" : "right"}
            title={monthLabel(hovered.month, true)}
            rows={[
              { label: t("monthly.income"), value: formatSEK(hovered.income), color: INCOME },
              { label: t("monthly.costs"), value: formatSEK(hovered.costs), color: COST },
              { label: t("monthly.result"), value: formatSEK(hovered.result), strong: true },
            ]}
          />
        )}
      </div>

      <Legend
        items={[
          { key: "income", label: t("monthly.income"), color: INCOME },
          { key: "costs", label: t("monthly.costs"), color: COST },
          { key: "result", label: t("monthly.result"), color: "var(--color-foreground)" },
        ]}
      />
    </figure>
  );
}

// ── 2. Ackumulerat resultat ─────────────────────────────────────────

/**
 * The result added up as the year goes, against the budget's pace.
 *
 * The pace is a straight line, and that is an assumption rather than a figure:
 * a budget is a year's total with no monthly split anywhere in it, so the only
 * thing that can be drawn is "if it were spent evenly". The subtitle says so.
 * It is still the line people want, because the question is not "was March
 * exactly a twelfth" but "by now, should we have more left than this".
 */
function Cumulative({
  months,
  monthLabel,
  budgetTotal,
  yearLength,
  offset,
}: {
  months: TrendMonth[];
  monthLabel: (month: string, long?: boolean) => string;
  /** The compared budget's result for the whole year, or null. */
  budgetTotal: number | null;
  /** How many months the financial year has, which is what the pace divides by. */
  yearLength: number;
  /** How many months of that year come before this period's first one. */
  offset: number;
}) {
  const t = useTranslations("ledger.charts");
  const geometry = useChartGeometry();
  const { W, H, PAD } = geometry;
  const plot = plotOf(geometry);
  const { ref, at, track, clear } = usePointerIndex(months.length, geometry);

  /** The budget spent evenly, at the end of the period's i-th month. */
  const pace = (i: number): number | null =>
    budgetTotal == null || yearLength <= 0
      ? null
      : (budgetTotal * (offset + i + 1)) / yearLength;

  const axis = useMemo(() => {
    const values = months.map((m) => m.cumulative);
    const paced = budgetTotal == null ? [] : months.map((_, i) => pace(i) ?? 0);
    return axisTicks(Math.min(0, ...values, ...paced), Math.max(0, ...values, ...paced));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [months, budgetTotal, yearLength, offset]);
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  const fmt = axisFormat(Math.max(Math.abs(lo), Math.abs(hi)));

  const y = linearScale(lo, hi, geometry);
  const x = (i: number) =>
    PAD.left + (months.length === 1 ? plot.w / 2 : (i / (months.length - 1)) * plot.w);

  const labels = fittedLabels(months.length, plot.w / Math.max(1, months.length - 1));
  const hovered = at == null ? null : months[at];
  const ACTUAL = seriesColor(0);

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={t("cumulative.alt")}
          onPointerMove={track}
          onPointerLeave={clear}
        >
          <YGrid ticks={axis} y={y} geometry={geometry} format={fmt} zeroRule />

          {budgetTotal != null && (
            <polyline
              points={months.map((_, i) => `${x(i)},${y(pace(i) ?? 0)}`).join(" ")}
              fill="none"
              className="stroke-muted"
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
          )}

          <polyline
            points={months.map((m, i) => `${x(i)},${y(m.cumulative)}`).join(" ")}
            fill="none"
            stroke={ACTUAL}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {labels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === months.length - 1 ? "end" : "middle"}
              className="fill-muted text-[11px]"
            >
              {monthLabel(months[i].month)}
            </text>
          ))}

          {hovered && (
            <>
              <line
                x1={x(at!)}
                x2={x(at!)}
                y1={PAD.top}
                y2={PAD.top + plot.h}
                className="stroke-foreground/40"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle cx={x(at!)} cy={y(hovered.cumulative)} r={3.5} fill={ACTUAL} />
            </>
          )}
        </svg>

        {hovered && (
          <Readout
            side={at! > months.length / 2 ? "left" : "right"}
            title={monthLabel(hovered.month, true)}
            rows={[
              {
                label: t("cumulative.actual"),
                value: formatSEK(hovered.cumulative),
                color: ACTUAL,
              },
              ...(budgetTotal == null
                ? []
                : [
                    {
                      label: t("cumulative.pace"),
                      value: formatSEK(pace(at!) ?? 0),
                      color: "var(--color-muted)",
                    },
                    {
                      label: t("cumulative.against"),
                      value: formatSEK(hovered.cumulative - (pace(at!) ?? 0)),
                      strong: true,
                    },
                  ]),
            ]}
          />
        )}
      </div>

      <Legend
        items={[
          { key: "actual", label: t("cumulative.actual"), color: ACTUAL },
          ...(budgetTotal == null
            ? []
            : [
                {
                  key: "pace",
                  label: t("cumulative.pace"),
                  color: "var(--color-muted)",
                },
              ]),
        ]}
      />
    </figure>
  );
}

// ── 3. Kostnadsställen ──────────────────────────────────────────────

/** How many rows the ranking shows before it asks. Twelve is about a screen. */
const RANKING_HEAD = 12;

/**
 * One bar per cost centre, around a zero line.
 *
 * Diverging, because a cost centre's result is as often negative as not and a
 * chart that took the magnitude would draw the section's best and worst month
 * the same length. HTML rather than SVG: every row is a name, a figure and a
 * bar, and only the bar is a picture.
 */
function CostCenterRanking({
  costCenters,
  noCostCenterLabel,
}: {
  costCenters: TrendCostCenter[];
  noCostCenterLabel: string;
}) {
  const t = useTranslations("ledger.charts");
  const [all, setAll] = useState(false);
  const shown = all ? costCenters : costCenters.slice(0, RANKING_HEAD);

  // One scale across every row, including the ones the budget marker reaches
  // past: bars that were each scaled to themselves would be a list of full-width
  // bars saying nothing.
  const extent = useMemo(() => {
    const values = costCenters.flatMap((c) => [c.result, ...(c.budget == null ? [] : [c.budget])]);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    return { lo, hi, span: hi - lo || 1 };
  }, [costCenters]);

  /** Where a value sits across the track, 0–100. */
  const pos = (v: number) => ((v - extent.lo) / extent.span) * 100;
  const zero = pos(0);

  return (
    <div className="space-y-1">
      {shown.map((c) => {
        const at = pos(c.result);
        const left = Math.min(zero, at);
        const width = Math.abs(at - zero);
        return (
          <div
            key={c.code ?? "none"}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm"
          >
            <span className="min-w-[9rem] flex-[3] truncate">
              {c.code ? (
                <>
                  <span className="tabular-nums text-muted">{c.code}</span>{" "}
                  {c.name ?? ""}
                </>
              ) : (
                <span className="text-muted">{noCostCenterLabel}</span>
              )}
            </span>

            {/* The track, and the zero it hangs from. `order` puts it under the
                name on a phone, where the row wraps, and back beside it from sm
                where there is width for both. Narrower than the name it stands
                beside: a bar says which is biggest, and the name is what you
                came to read. */}
            <span className="relative order-last h-5 w-full min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-[2]">
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-border"
                style={{ left: `${zero}%` }}
              />
              <span
                aria-hidden
                className="absolute inset-y-1 rounded-[3px]"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: c.code ? seriesColor(0) : CHART_NEUTRAL,
                }}
              />
              {c.budget != null && c.budget !== 0 && (
                // The plan, as a mark rather than a second bar: what is being
                // read is the distance between them.
                <span
                  aria-hidden
                  title={t("ranking.budgetMark")}
                  className="absolute inset-y-0 w-0.5 bg-foreground/70"
                  style={{ left: `calc(${pos(c.budget)}% - 1px)` }}
                />
              )}
            </span>

            <span className="ml-auto shrink-0 text-right tabular-nums sm:ml-0 sm:w-28">
              {money(c.result)}
            </span>
          </div>
        );
      })}

      {costCenters.length > RANKING_HEAD && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="pt-1 text-sm font-medium text-accent hover:underline"
        >
          {all ? t("ranking.showFewer") : t("ranking.showAll", { count: costCenters.length })}
        </button>
      )}
    </div>
  );
}

// ── 4. Kostnader per kostnadsställe ─────────────────────────────────

/** How many cost centres get a band of their own before the rest are swept
 *  together. One under the palette, so "Övriga" can keep the neutral. */
const STACK_BANDS = Math.min(6, CHART_SERIES_COUNT);

/**
 * Each month's spending, split by who spent it.
 *
 * Stacked bars, not a stacked area: twelve months is a short series, and a bar
 * says "this month" where an area says "at this instant", which is the wrong
 * claim about a figure that is a month's worth of vouchers.
 *
 * Costs only. A stack of results would have bands changing sign inside a
 * column, which is a shape with no meaning: you cannot stack a number that
 * might be negative on top of one that might not.
 */
function CostCenterStack({
  trend,
  monthLabel,
  noCostCenterLabel,
}: {
  trend: LedgerTrend;
  monthLabel: (month: string, long?: boolean) => string;
  noCostCenterLabel: string;
}) {
  const t = useTranslations("ledger.charts");
  const geometry = useChartGeometry();
  const { W, H, PAD } = geometry;
  const plot = plotOf(geometry);
  const { ref, at, track, clear } = usePointerIndex(trend.stack.length, geometry);
  const clipId = useId();

  /** The bands, in the order they stack: the biggest spenders, then the rest. */
  const bands = useMemo(() => {
    const spenders = trend.costCenters
      .filter((c) => c.costs < 0)
      .sort((a, b) => a.costs - b.costs); // most negative first
    const head = spenders.slice(0, STACK_BANDS);
    const tail = spenders.slice(STACK_BANDS);
    return [
      ...head.map((c, i) => ({
        key: c.code ?? "",
        label: c.code ? `${c.code} – ${c.name ?? ""}` : noCostCenterLabel,
        color: c.code ? seriesColor(i) : CHART_NEUTRAL,
        codes: [c.code ?? ""],
      })),
      ...(tail.length > 0
        ? [
            {
              key: "__rest__",
              label: t("stack.others", { count: tail.length }),
              color: CHART_NEUTRAL,
              codes: tail.map((c) => c.code ?? ""),
            },
          ]
        : []),
    ];
  }, [trend.costCenters, noCostCenterLabel, t]);

  /** Each month's bands, as magnitudes, in stacking order. */
  const columns = useMemo(
    () =>
      trend.stack.map((s) => ({
        month: s.month,
        values: bands.map((b) => b.codes.reduce((sum, code) => sum + (s.values[code] ?? 0), 0)),
      })),
    [trend.stack, bands],
  );

  const axis = useMemo(
    () => axisTicks(0, Math.max(0, ...columns.map((c) => c.values.reduce((a, b) => a + b, 0)))),
    [columns],
  );
  const hi = axis[axis.length - 1];
  const fmt = axisFormat(hi);

  const y = linearScale(0, hi || 1, geometry);
  const band = plot.w / Math.max(1, columns.length);
  const barW = Math.max(2, band * 0.6);
  const cx = (i: number) => PAD.left + band * (i + 0.5);

  const labels = fittedLabels(columns.length, band);
  const hovered = at == null ? null : columns[at];

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          ref={ref}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={t("stack.alt")}
          onPointerMove={track}
          onPointerLeave={clear}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={plot.w} height={plot.h} />
            </clipPath>
          </defs>

          <YGrid ticks={axis} y={y} geometry={geometry} format={fmt} />

          <g clipPath={`url(#${clipId})`}>
            {columns.map((c, i) => {
              let floor = 0;
              return (
                <g key={c.month}>
                  {c.values.map((v, b) => {
                    if (v <= 0) return null;
                    const top = floor + v;
                    const rect = (
                      <rect
                        key={bands[b].key}
                        x={cx(i) - barW / 2}
                        y={y(top)}
                        width={barW}
                        height={Math.max(1, y(floor) - y(top))}
                        fill={bands[b].color}
                      />
                    );
                    floor = top;
                    return rect;
                  })}
                </g>
              );
            })}
          </g>

          {labels.map((i) => (
            <text
              key={i}
              x={cx(i)}
              y={H - 8}
              textAnchor="middle"
              className="fill-muted text-[11px]"
            >
              {monthLabel(columns[i].month)}
            </text>
          ))}
        </svg>

        {hovered && (
          <Readout
            side={at! > columns.length / 2 ? "left" : "right"}
            title={monthLabel(hovered.month, true)}
            rows={[
              ...bands
                .map((b, i) => ({ b, v: hovered.values[i] }))
                .filter(({ v }) => v > 0)
                .map(({ b, v }) => ({ label: b.label, value: money(v), color: b.color })),
              {
                label: t("stack.total"),
                value: money(hovered.values.reduce((a, b) => a + b, 0)),
                strong: true,
              },
            ]}
          />
        )}
      </div>

      <Legend items={bands.map((b) => ({ key: b.key, label: b.label, color: b.color }))} />
    </figure>
  );
}

// ── 5. Vad pengarna gick till ───────────────────────────────────────

/**
 * The period's costs by BAS section, as one bar and a list under it.
 *
 * A bar rather than a pie, for the reason a bar is nearly always right: a
 * length can be compared and an angle cannot. The list under it is where the
 * figures actually get read; the bar is there to say which one is most of it.
 */
function CostComposition({ sections }: { sections: LedgerTrend["sections"] }) {
  const t = useTranslations("ledger.charts");
  const tSection = useTranslations("ledger.section");

  // Costs arrive negative, like everything else here. A composition is about
  // magnitude, so it is the magnitudes that are shared out.
  const rows = useMemo(() => {
    const total = sections.reduce((s, x) => s + Math.abs(x.total), 0);
    return sections
      .map((s, i) => ({
        key: s.key,
        total: s.total,
        magnitude: Math.abs(s.total),
        share: total > 0 ? (Math.abs(s.total) / total) * 100 : 0,
        color: seriesColor(i),
      }))
      .sort((a, b) => b.magnitude - a.magnitude);
  }, [sections]);

  return (
    <div className="space-y-3">
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-surface"
        role="img"
        aria-label={t("composition.alt")}
      >
        {rows.map((r) => (
          <span
            key={r.key}
            className="h-full"
            style={{ width: `${r.share}%`, background: r.color }}
          />
        ))}
      </div>

      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex flex-wrap items-center gap-x-3 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{ background: r.color }}
            />
            <span className="min-w-[8rem] flex-1 truncate">{tSection(r.key)}</span>
            <span className="ml-auto flex shrink-0 items-baseline gap-3">
              <span className="w-28 text-right tabular-nums">{money(r.total)}</span>
              <span className="w-10 text-right text-xs tabular-nums text-muted">
                {t("composition.share", { share: r.share.toFixed(0) })}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── The view ────────────────────────────────────────────────────────

export interface TrendResponse {
  year: { id: number; year: number } | null;
  period: { from: string; to: string } | null;
  yearPeriod: { from: string; to: string } | null;
  trend: LedgerTrend | null;
  budget: string | null;
}

/** Months between two "YYYY-MM", inclusive of both. */
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

export function ReportCharts({
  data,
  monthLabel,
  noCostCenterLabel,
}: {
  data: TrendResponse;
  /** A month key as a person reads it. `long` asks for the unabbreviated form,
   *  which the readouts use and the cramped axis does not. */
  monthLabel: (month: string, long?: boolean) => string;
  noCostCenterLabel: string;
}) {
  const t = useTranslations("ledger.charts");
  const trend = data.trend;

  const empty =
    !trend ||
    trend.months.length === 0 ||
    trend.months.every((m) => m.income === 0 && m.costs === 0);

  if (empty) return <EmptyNote size="page">{t("empty")}</EmptyNote>;

  const yearLength =
    data.yearPeriod == null ? 12 : monthSpan(data.yearPeriod.from, data.yearPeriod.to);
  const offset =
    data.yearPeriod == null || data.period == null
      ? 0
      : monthSpan(data.yearPeriod.from, data.period.from) - 1;

  const hasCostCenters = trend.costCenters.length > 0;
  const spending = trend.costCenters.some((c) => c.costs < 0);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={t("monthly.title")} subtitle={t("monthly.hint")} />
        <CardBody>
          <MonthlyResult months={trend.months} monthLabel={monthLabel} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={t("cumulative.title")}
          subtitle={
            trend.budgetTotal == null ? t("cumulative.noBudget") : t("cumulative.withBudget")
          }
        />
        <CardBody>
          <Cumulative
            months={trend.months}
            monthLabel={monthLabel}
            budgetTotal={trend.budgetTotal}
            yearLength={yearLength}
            offset={offset}
          />
        </CardBody>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title={t("ranking.title")}
            subtitle={
              trend.costCenters.some((c) => c.budget != null)
                ? `${t("ranking.hint")} ${t("ranking.budgetMark")}`
                : t("ranking.hint")
            }
          />
          <CardBody>
            {hasCostCenters ? (
              <CostCenterRanking
                costCenters={trend.costCenters}
                noCostCenterLabel={noCostCenterLabel}
              />
            ) : (
              <EmptyNote>{t("empty")}</EmptyNote>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t("composition.title")} subtitle={t("composition.hint")} />
          <CardBody>
            {trend.sections.length > 0 ? (
              <CostComposition sections={trend.sections} />
            ) : (
              <EmptyNote>{t("empty")}</EmptyNote>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title={t("stack.title")} subtitle={t("stack.hint")} />
        <CardBody>
          {spending ? (
            <CostCenterStack
              trend={trend}
              monthLabel={monthLabel}
              noCostCenterLabel={noCostCenterLabel}
            />
          ) : (
            <EmptyNote>{t("empty")}</EmptyNote>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
