"use client";

// Stacked area of the cellar's worth by drink type, hand-drawn SVG with the app's tokens rather than a chart library.
import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";

import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory } from "@/lib/domain/types";
import { DRINK_SERIES } from "@/lib/ui/chart-colors";
import {
  axisTicks,
  labelPositions,
  linearScale,
  plotOf,
  useChartGeometry,
  usePointerIndex,
} from "@/lib/ui/chart-geometry";
import { YGrid } from "@/components/ui/chart-axis";
import { cn } from "@/lib/ui/utils";
import { formatNumber } from "@/lib/ui/format";
import { oreToSEK } from "@/lib/domain/money";

export interface ValuePoint {
  date: string;
  byCategory: Record<DrinkCategory, number>;
  totalOre: number;
}

export function StockValueChart({
  points,
  className,
}: {
  points: ValuePoint[];
  className?: string;
}) {
  const t = useTranslations("stock.stats");
  const clipId = useId();

  // One of the two module constants in lib/ui/chart-geometry, so its identity is stable for the memos.
  const geometry = useChartGeometry();
  const { W, H, PAD, labels: wantedLabels } = geometry;
  const PLOT = plotOf(geometry);

  const max = useMemo(() => Math.max(1, ...points.map((p) => p.totalOre)), [points]);
  // From zero: a shelf is never worth less than nothing.
  const axis = useMemo(() => axisTicks(0, max), [max]);
  const top = axis[axis.length - 1];

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? PLOT.w / 2 : (i / (points.length - 1)) * PLOT.w);
  const y = linearScale(0, top, geometry);

  // "point", not "band": a day's value sits at a position, and the readout snaps to the nearest.
  const { ref: svgRef, at, track, clear } = usePointerIndex(points.length, geometry, "point");

  /** One closed path per band, stacked from the bottom: each needs its own colour and its underside is the previous band's top, reversed. */
  const bands = useMemo(() => {
    const floors = points.map(() => 0);
    return CATEGORIES.map((category) => {
      const tops = points.map((p, i) => floors[i] + Math.max(0, p.byCategory[category] ?? 0));
      const up = points.map((_, i) => `${x(i)},${y(tops[i])}`);
      const down = points.map((_, i) => `${x(i)},${y(floors[i])}`).reverse();
      const carries = tops.some((v, i) => v - floors[i] > 0);
      const d = `M${up.join("L")}L${down.join("L")}Z`;
      for (let i = 0; i < floors.length; i++) floors[i] = tops[i];
      return { category, d, carries };
    });
    // `x` and `y` read the geometry, so a change of coordinate space must redraw the bands. `geometry` is a stable module constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, top, geometry]);

  const hovered = at == null ? null : points[at];

  /** Evenly spaced label positions, both ends included. A date needs about 90 units of the wide space and 70 of the narrow one. */
  const labels = useMemo(
    () => labelPositions(points.length, wantedLabels),
    [points.length, wantedLabels],
  );

  return (
    <figure className={cn("m-0", className)}>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none"
          role="img"
          aria-label={t("chartAlt")}
          onPointerMove={track}
          onPointerLeave={clear}
        >
          <defs>
            {/* Clip the bands so a rounding at the top tick cannot paint over the axis. */}
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={PLOT.w} height={PLOT.h} />
            </clipPath>
          </defs>

          <YGrid
            ticks={axis}
            y={y}
            geometry={geometry}
            format={(v) => formatNumber(oreToSEK(v), 0, 0)}
          />

          <g clipPath={`url(#${clipId})`}>
            {bands.map(({ category, d, carries }) =>
              carries ? (
                <path
                  key={category}
                  d={d}
                  fill={DRINK_SERIES[category]}
                  // A 2px gap in the card's colour keeps two bands from reading as one shape.
                  stroke="var(--color-background)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ) : null,
            )}
          </g>

          {labels.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
              className="fill-muted text-[11px] tabular-nums"
            >
              {points[i]?.date}
            </text>
          ))}

          {hovered && (
            <line
              x1={x(at!)}
              x2={x(at!)}
              y1={PAD.top}
              y2={PAD.top + PLOT.h}
              className="stroke-foreground/40"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}
        </svg>

        {hovered && (
          <div
            className={cn(
              "pointer-events-none absolute top-2 w-44 rounded-panel border border-border bg-background p-2.5 shadow-[var(--shadow-pop)]",
              at! > points.length / 2 ? "left-16" : "right-3",
            )}
          >
            <p className="mb-1.5 text-xs font-medium tabular-nums">{hovered.date}</p>
            <dl className="space-y-0.5">
              {CATEGORIES.filter((c) => (hovered.byCategory[c] ?? 0) !== 0).map((c) => (
                <div key={c} className="flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-mark"
                    style={{ background: DRINK_SERIES[c] }}
                  />
                  <dt className="min-w-0 flex-1 truncate text-muted">{t(`category.${c}`)}</dt>
                  <dd className="tabular-nums">
                    {formatNumber(oreToSEK(hovered.byCategory[c]), 0, 0)}
                  </dd>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 text-xs font-medium">
                <dt className="min-w-0 flex-1">{t("total")}</dt>
                <dd className="tabular-nums">{formatNumber(oreToSEK(hovered.totalOre), 0, 0)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Always present: five bands cannot be told apart by colour alone. */}
      <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {CATEGORIES.map((c) => (
          <span key={c} className="flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden
              className="size-2.5 rounded-mark"
              style={{ background: DRINK_SERIES[c] }}
            />
            {t(`category.${c}`)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
