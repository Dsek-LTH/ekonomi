"use client";

// What the cellar has been worth, stacked by drink type.
//
// Hand-drawn SVG rather than a charting library, for the reason every other
// component here is hand-drawn: one shelf of five series does not need 40 kB of
// abstraction, and the app's own tokens are what make it look like the app.
//
// The form is a stacked area because the question is a magnitude over time that
// is also made of parts: how much is on the shelf, and how much of it is beer.
// A line per type would answer the second and lose the first.
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

export interface ValuePoint {
  date: string;
  byCategory: Record<DrinkCategory, number>;
  totalOre: number;
}

const kr = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });

export function StockValueChart({
  points,
  className,
}: {
  points: ValuePoint[];
  className?: string;
}) {
  const t = useTranslations("stock.stats");
  const clipId = useId();

  // One of the two module constants in lib/ui/chart-geometry, never a computed
  // one, so its identity is stable and the memos below can depend on it.
  const geometry = useChartGeometry();
  const { W, H, PAD, labels: wantedLabels } = geometry;
  const PLOT = plotOf(geometry);

  const max = useMemo(
    () => Math.max(1, ...points.map((p) => p.totalOre)),
    [points],
  );
  // From zero: a shelf is never worth less than nothing, so the axis this chart
  // wants is the one-sided case of the shared ladder.
  const axis = useMemo(() => axisTicks(0, max), [max]);
  const top = axis[axis.length - 1];

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? PLOT.w / 2 : (i / (points.length - 1)) * PLOT.w);
  const y = linearScale(0, top, geometry);

  // "point", not "band": this is an area chart, so a day's value sits *at* a
  // position rather than filling one, and the readout snaps to the nearest.
  const { ref: svgRef, at, track, clear } = usePointerIndex(points.length, geometry, "point");

  /**
   * One band per drink type, stacked from the bottom.
   *
   * Drawn as a closed path per band rather than as one path with a fill rule:
   * each band needs its own colour, and its underside is the previous band's
   * top, walked backwards.
   */
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
    // `x` and `y` read the geometry, so a change of coordinate space has to
    // redraw the bands. `geometry` is in the list and is one of two module
    // constants, so its identity is stable; the rule cannot see the dependency
    // through the two closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, top, geometry]);

  const hovered = at == null ? null : points[at];

  /** Evenly spaced label positions, both ends always among them. A date needs
   *  about 90 units of the wide space and about 70 of the narrow one, which is
   *  what each geometry's `labels` counts. */
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
            {/* The bands are clipped rather than trusted to stay inside: a
                rounding at the top tick would otherwise paint over the axis. */}
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={PLOT.w} height={PLOT.h} />
            </clipPath>
          </defs>

          {/* Recessive grid: it is there to be measured against, not read. */}
          <YGrid
            ticks={axis}
            y={y}
            geometry={geometry}
            format={(v) => kr.format(v / 100)}
          />

          <g clipPath={`url(#${clipId})`}>
            {bands.map(({ category, d, carries }) =>
              carries ? (
                <path
                  key={category}
                  d={d}
                  fill={DRINK_SERIES[category]}
                  // The 2px gap that keeps two bands from reading as one shape,
                  // painted in the card's own colour rather than left as a hole.
                  stroke="var(--color-background)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                />
              ) : null,
            )}
          </g>

          {/* As many dates as fit, evenly spaced, ends included. A date needs
              about 90px at this size, so five is what a 960-wide plot holds
              without them touching; a label per point would be a smear, and the
              day under the pointer is on the readout anyway. */}
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

        {/* The readout, in HTML rather than SVG text: it is a small table, and a
            table is what HTML is for. Positioned over the plot, on the side the
            crosshair is not. */}
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
                <div key={c} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-mark"
                    style={{ background: DRINK_SERIES[c] }}
                  />
                  <dt className="min-w-0 flex-1 truncate text-muted">{t(`category.${c}`)}</dt>
                  <dd className="tabular-nums">{kr.format(hovered.byCategory[c] / 100)}</dd>
                </div>
              ))}
              <div className="mt-1 flex items-center gap-1.5 border-t border-border pt-1 text-[11px] font-medium">
                <dt className="min-w-0 flex-1">{t("total")}</dt>
                <dd className="tabular-nums">{kr.format(hovered.totalOre / 100)}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      {/* Always present, because five bands cannot be told apart by colour
          alone and should not have to be. */}
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
