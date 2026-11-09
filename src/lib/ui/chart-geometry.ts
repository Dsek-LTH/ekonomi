"use client";

import { useRef, useState } from "react";

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
 * The drawing's coordinate space, which the browser scales to the width given. There are two so that 11px axis text
 * stays 11px on a phone (a 960-unit viewBox would shrink it to under 4px).
 */
const WIDE_GEOMETRY: ChartGeometry = {
  W: 960,
  H: 300,
  PAD: { top: 12, right: 12, bottom: 26, left: 62 },
  labels: 5,
};

const NARROW_GEOMETRY: ChartGeometry = {
  W: 320,
  H: 220,
  PAD: { top: 10, right: 6, bottom: 22, left: 50 },
  labels: 3,
};

/** Which of the two this render is in, at `md`. Returns a module constant so a memo may depend on it. */
export function useChartGeometry(): ChartGeometry {
  return usePhone() ? NARROW_GEOMETRY : WIDE_GEOMETRY;
}

/** The plot rectangle inside a geometry's padding. */
export function plotOf(g: ChartGeometry): { w: number; h: number } {
  return { w: g.W - g.PAD.left - g.PAD.right, h: g.H - g.PAD.top - g.PAD.bottom };
}

/**
 * An axis of four or five round ticks. The outermost ticks are at or beyond the data (never clipped).
 * `min` lets a chart whose values can be negative start below zero; stock charts pass 0.
 */
export function axisTicks(min: number, max: number): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo;
  if (span <= 0) return [0];

  // Target four intervals: the step is the round number at or above a quarter of the span.
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;

  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const out: number[] = [];
  // Counted, not accumulated: adding a float step leaves 2.5000000000000004.
  const count = Math.round((last - first) / step);
  for (let i = 0; i <= count; i++) out.push(first + i * step);
  return out;
}

/**
 * Label positions for short, evenly spaced labels (months): every one that fits, then every second, third.
 * `spacing` is the distance between neighbours in drawing units, `need` the room one label wants.
 */
export function fittedLabels(count: number, spacing: number, need = 26): number[] {
  if (count <= 0) return [];
  const step = Math.max(1, Math.ceil(need / Math.max(1, spacing)));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/** Evenly spaced label positions along a series, both ends included. `wanted` comes from the geometry. */
export function labelPositions(count: number, wanted: number): number[] {
  const last = count - 1;
  if (last <= 0) return count === 0 ? [] : [0];
  const n = Math.min(wanted, count);
  const step = last / (n - 1);
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(i * step)))];
}

/** A value's y coordinate on an axis running `lo` to `hi`. `hi === lo` puts the line on the floor instead of NaN. */
export function linearScale(lo: number, hi: number, g: ChartGeometry): (value: number) => number {
  const plot = plotOf(g);
  const span = hi - lo;
  return (value) => g.PAD.top + plot.h - (span === 0 ? 0 : ((value - lo) / span) * plot.h);
}

/**
 * Which point or band the pointer is over, plus a ref for the svg.
 * "band": bar chart, index floored. "point": line or area chart, nearest index.
 */
export function usePointerIndex(count: number, g: ChartGeometry, mode: "band" | "point" = "band") {
  const ref = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<number | null>(null);
  const plot = plotOf(g);

  function track(e: React.PointerEvent<SVGSVGElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || count === 0) return;
    // Into the drawing's own units, which are not the pixels it is rendered at.
    const local = ((e.clientX - rect.left) / rect.width) * g.W;
    const ratio = (local - g.PAD.left) / plot.w;
    const i = mode === "band" ? Math.floor(ratio * count) : Math.round(ratio * (count - 1));
    setAt(Math.min(count - 1, Math.max(0, i)));
  }

  return { ref, at, track, clear: () => setAt(null) };
}
