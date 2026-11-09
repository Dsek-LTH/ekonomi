// The categorical palette and the order series are handed out in. Values are `var()` strings (colours live in
// globals.css) used as inline styles, since Tailwind cannot generate classes for runtime colours.
import type { DrinkCategory } from "@/lib/domain/types";

/**
 * The seven hues in the order a chart should spend them, not numeric order: adjacent bands must be distinguishable,
 * and the warning amber and danger red (close for a deuteranope) are kept four steps apart. Pink leads, red is last.
 */
const CHART_SERIES = [
  "var(--chart-1)", // pink, the section's
  "var(--chart-6)", // indigo
  "var(--chart-3)", // green
  "var(--chart-2)", // purple
  "var(--chart-4)", // amber
  "var(--chart-7)", // teal
  "var(--chart-5)", // red, last
] as const;

/** The eighth, kept out of the rotation: for the "övriga" tail (rows with no cost centre), which is not a committee. */
export const CHART_NEUTRAL = "var(--chart-8)";

/** How many series can be told apart before a chart should start grouping. */
export const CHART_SERIES_COUNT = CHART_SERIES.length;

/** The colour for the nth series. Wraps rather than returning undefined; callers with more series should group the tail into `CHART_NEUTRAL`. */
export function seriesColor(index: number): string {
  return CHART_SERIES[((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length];
}

/**
 * The five drink types on the shared palette: beer amber, wine pink, spirits blue. Of the assignments keeping those,
 * this one has the largest minimum distance (ΔE 13.2) between neighbours in `CATEGORIES` order.
 */
export const DRINK_SERIES: Record<DrinkCategory, string> = {
  OL: "var(--chart-4)", // amber
  OVRIG_JASTDRYCK: "var(--chart-2)", // purple
  VIN: "var(--chart-1)", // pink
  SPRITDRYCK: "var(--chart-6)", // indigo
  ALKOHOLDRYCKSLIKNANDE: "var(--chart-7)", // teal
};
