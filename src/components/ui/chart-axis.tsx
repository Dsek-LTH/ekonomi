import type { ChartGeometry } from "@/lib/ui/chart-geometry";

export function YGrid({
  ticks,
  y,
  geometry,
  format,
  /** Draw zero as a fact (a cumulative result crossing it) rather than as a ruler mark. */
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
