"use client";

// The two things every hand-drawn chart in this app needs before it can draw
// anything: a coordinate space to draw in, and an axis a person can read.
//
// Both were written inside the stock value chart first. They came out here when
// the utfall charts needed the same two answers, because the interesting part
// of each is a decision rather than a calculation, and a decision copied is a
// decision that gets made differently the second time.
import { usePhone } from "./media";

export interface ChartGeometry {
  /** The viewBox's own width and height, in its own units. */
  W: number;
  H: number;
  PAD: { top: number; right: number; bottom: number; left: number };
  /** How many x-axis labels fit without them touching. */
  labels: number;
}

/**
 * The drawing's coordinate space, which the browser scales to the width it is
 * given. Two of them, because one is not enough.
 *
 * A viewBox scales everything in it, text included, and 960 units laid across a
 * phone is a scale of about a third: 11px axis figures land at under 4px, which
 * is a chart with a grey smudge where its numbers should be. So the phone gets
 * a coordinate space roughly the size it will actually be drawn at, and the
 * same 11px is 11px.
 *
 * The numbers are otherwise chosen so a hairline is a hairline at the width
 * each renders at, and the left pad is what the widest tick figure needs.
 */
export const WIDE_GEOMETRY: ChartGeometry = {
  W: 960,
  H: 300,
  PAD: { top: 12, right: 12, bottom: 26, left: 62 },
  labels: 5,
};

export const NARROW_GEOMETRY: ChartGeometry = {
  W: 320,
  H: 220,
  PAD: { top: 10, right: 6, bottom: 22, left: 50 },
  labels: 3,
};

/**
 * Which of the two this render is in, at `md`, like every other shape change in
 * the app.
 *
 * Returns one of the two module constants and never a computed object, so its
 * identity is stable and a memo may depend on it.
 */
export function useChartGeometry(): ChartGeometry {
  return usePhone() ? NARROW_GEOMETRY : WIDE_GEOMETRY;
}

/** The plot rectangle inside a geometry's padding. */
export function plotOf(g: ChartGeometry): { w: number; h: number } {
  return { w: g.W - g.PAD.left - g.PAD.right, h: g.H - g.PAD.top - g.PAD.bottom };
}

/**
 * An axis a person reads: four or five round figures, not the data's own
 * extremes to the öre.
 *
 * The outermost ticks are at or beyond the data, always. An axis that stops
 * short of the data is not a rounding, it is a chart with its top cut off: the
 * band is clipped at the plot's edge and the series silently looks flat for a
 * month.
 *
 * `min` is what makes this the utfall's axis as well as the stock's. A shelf is
 * never worth less than nothing, so that chart asks for `axisTicks(0, max)` and
 * gets exactly the ladder it always had. A month of the section's accounts is
 * very often a loss, and an axis that started at zero would draw it as nothing
 * at all.
 */
export function axisTicks(min: number, max: number): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo;
  if (span <= 0) return [0];

  // Four intervals is the target, so the step is the round number at or above a
  // quarter of the span. 2.5 is in the list because a 25 000 step reads as
  // roundly as a 20 000 one and often fits the data better.
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;

  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const out: number[] = [];
  // Counted rather than accumulated: adding a float step to itself a dozen
  // times leaves 2.5000000000000004 on the axis.
  const count = Math.round((last - first) / step);
  for (let i = 0; i <= count; i++) out.push(first + i * step);
  return out;
}

/**
 * Label positions for a series whose labels are short and evenly spaced: every
 * one that fits, and then every second, every third.
 *
 * The other rule below thins a series down to a fixed count, which is right for
 * an ISO date needing 90 units of a 960-unit chart. A month is "Jan", and
 * twelve of those fit across the same chart with room to spare; thinning them
 * to five leaves a bar chart whose columns mostly have no name. So this one
 * asks the opposite question: given how far apart they sit, how many can be
 * shown?
 *
 * `spacing` is the distance between neighbours in the drawing's own units,
 * `need` how much room one label wants.
 */
export function fittedLabels(count: number, spacing: number, need = 26): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(need / Math.max(1, spacing)));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/**
 * Evenly spaced label positions along a series, both ends always among them.
 *
 * `wanted` comes from the geometry rather than from the data: how many dates
 * fit is a fact about how wide the chart is.
 */
export function labelPositions(count: number, wanted: number): number[] {
  const last = count - 1;
  if (last <= 0) return count === 0 ? [] : [0];
  const n = Math.min(wanted, count);
  const step = last / (n - 1);
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(i * step)))];
}
