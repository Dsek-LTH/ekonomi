"use client";

// The horizontal rules a chart is read against, and the figures beside them.
//
// Four charts drew this: the three in the utfall report and the stock value
// chart. Same `<g>`, same `stroke-border`, same `textAnchor="end"`, same
// `dominantBaseline="middle"`, same `text-[11px] tabular-nums`, four times, so
// a change to how an axis looks was four edits and a chance to miss one.
//
// What the axis *is* stays in lib/ui/chart-geometry.ts (`axisTicks` picks the
// ladder, `linearScale` maps a value onto it). This is only how it is drawn.
import type { ChartGeometry } from "@/lib/ui/chart-geometry";

export function YGrid({
  ticks,
  y,
  geometry,
  format,
  /**
   * Whether the zero line is drawn as a fact rather than as a ruler mark.
   *
   * On where zero falls inside the plot and means something: a cumulative
   * result crossing it is the moment the section went into the red. Off where
   * the chart draws its own zero line over the bars instead (the monthly
   * result), and where the axis starts at zero anyway and the bottom rule is
   * just the floor (the stock value chart).
   */
  zeroRule = false,
}: {
  ticks: readonly number[];
  y: (v: number) => number;
  geometry: ChartGeometry;
  format: (v: number) => string;
  zeroRule?: boolean;
}) {
  const { W, PAD } = geometry;
  return (
    <>
      {ticks.map((v) => (
        <g key={v}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(v)}
            y2={y(v)}
            className={zeroRule && v === 0 ? "stroke-foreground/45" : "stroke-border"}
            strokeWidth={1}
          />
          <text
            x={PAD.left - 8}
            y={y(v)}
            textAnchor="end"
            dominantBaseline="middle"
            className="fill-muted text-[11px] tabular-nums"
          >
            {format(v)}
          </text>
        </g>
      ))}
    </>
  );
}
