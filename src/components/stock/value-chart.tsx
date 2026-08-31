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
import { useId, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory } from "@/lib/domain/types";
import { cn } from "@/lib/ui/utils";

export interface ValuePoint {
  date: string;
  byCategory: Record<DrinkCategory, number>;
  totalOre: number;
}

/** The token each band is painted with. Defined in globals.css, one per drink
 *  type, stepped for each theme and checked against the colour-blind
 *  separation rules rather than picked by eye. */
const SERIES: Record<DrinkCategory, string> = {
  OL: "var(--series-ol)",
  OVRIG_JASTDRYCK: "var(--series-ovrig-jastdryck)",
  VIN: "var(--series-vin)",
  SPRITDRYCK: "var(--series-spritdryck)",
  ALKOHOLDRYCKSLIKNANDE: "var(--series-alkoholdrycksliknande)",
};

// The drawing is done in its own coordinate space and scaled by the browser, so
// the component needs no measuring to be responsive. The numbers are chosen so
// a hairline is a hairline at the width this actually renders at.
const W = 960;
const H = 300;
const PAD = { top: 12, right: 12, bottom: 26, left: 62 };
const PLOT = { w: W - PAD.left - PAD.right, h: H - PAD.top - PAD.bottom };

const kr = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });

/**
 * A y axis a person reads: four or five round figures, not the data's own
 * maximum to the öre.
 *
 * The last tick is at or above the peak, always. An axis that stops under the
 * data is not a rounding, it is a chart with its top cut off: the band is
 * clipped at the plot's edge and the shelf silently looks flat for a month.
 */
function ticks(maxOre: number): number[] {
  if (maxOre <= 0) return [0];
  const rough = maxOre / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const out: number[] = [];
  for (let v = 0; v < maxOre; v += step) out.push(v);
  out.push(out[out.length - 1] + step);
  return out;
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);

  const max = useMemo(
    () => Math.max(1, ...points.map((p) => p.totalOre)),
    [points],
  );
  const axis = useMemo(() => ticks(max), [max]);
  const top = axis[axis.length - 1];

  const x = (i: number) =>
    PAD.left + (points.length === 1 ? PLOT.w / 2 : (i / (points.length - 1)) * PLOT.w);
  const y = (ore: number) => PAD.top + PLOT.h - (ore / top) * PLOT.h;

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
      const up = points.map((p, i) => `${x(i)},${y(tops[i])}`);
      const down = points.map((p, i) => `${x(i)},${y(floors[i])}`).reverse();
      const carries = tops.some((v, i) => v - floors[i] > 0);
      const d = `M${up.join("L")}L${down.join("L")}Z`;
      for (let i = 0; i < floors.length; i++) floors[i] = tops[i];
      return { category, d, carries };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, top]);

  const hovered = at == null ? null : points[at];

  /** Evenly spaced label positions, both ends always among them. */
  const labels = useMemo(() => {
    const last = points.length - 1;
    if (last <= 0) return [0];
    const wanted = Math.min(5, last + 1);
    const step = last / (wanted - 1);
    return [...new Set(Array.from({ length: wanted }, (_, n) => Math.round(n * step)))];
  }, [points.length]);

  /** The point under the pointer, in the chart's own coordinates. */
  function track(e: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || points.length === 0) return;
    const local = ((e.clientX - rect.left) / rect.width) * W;
    const ratio = (local - PAD.left) / PLOT.w;
    const i = Math.round(ratio * (points.length - 1));
    setAt(Math.min(points.length - 1, Math.max(0, i)));
  }

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
          onPointerLeave={() => setAt(null)}
        >
          <defs>
            {/* The bands are clipped rather than trusted to stay inside: a
                rounding at the top tick would otherwise paint over the axis. */}
            <clipPath id={clipId}>
              <rect x={PAD.left} y={PAD.top} width={PLOT.w} height={PLOT.h} />
            </clipPath>
          </defs>

          {/* Recessive grid: it is there to be measured against, not read. */}
          {axis.map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(v)}
                y2={y(v)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 8}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted text-[11px] tabular-nums"
              >
                {kr.format(v / 100)}
              </text>
            </g>
          ))}

          <g clipPath={`url(#${clipId})`}>
            {bands.map(({ category, d, carries }) =>
              carries ? (
                <path
                  key={category}
                  d={d}
                  fill={SERIES[category]}
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
              "pointer-events-none absolute top-2 w-44 rounded-xl border border-border bg-background p-2.5 shadow-[var(--shadow-pop)]",
              at! > points.length / 2 ? "left-16" : "right-3",
            )}
          >
            <p className="mb-1.5 text-xs font-medium tabular-nums">{hovered.date}</p>
            <dl className="space-y-0.5">
              {CATEGORIES.filter((c) => (hovered.byCategory[c] ?? 0) !== 0).map((c) => (
                <div key={c} className="flex items-center gap-1.5 text-[11px]">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: SERIES[c] }}
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
              className="size-2.5 rounded-[3px]"
              style={{ background: SERIES[c] }}
            />
            {t(`category.${c}`)}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
