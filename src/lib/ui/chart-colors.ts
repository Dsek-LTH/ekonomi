// The app's one categorical palette, and who gets which slot.
//
// The colours themselves are `--chart-1` … `--chart-8` in globals.css, where
// six of the eight are aliases of the status tones an utlägg is already drawn
// in. This module is the other half of that decision: the *order* series are
// handed out in, which is a reading decision rather than a colour one and does
// not belong in a stylesheet.
//
// Everything here is a `var()` string rather than a hex value, so a chart drawn
// with it follows the theme without knowing there is one. They go into `fill`,
// `stroke` and `background` as inline styles: Tailwind reads classes out of the
// source as text and can generate nothing for a colour picked at runtime.
import type { DrinkCategory } from "@/lib/domain/types";

/**
 * The seven hues, in the order a chart should spend them.
 *
 * Not their numeric order, and that is the whole point of the list existing.
 * Adjacent pairs are what a stacked chart puts against each other, so the
 * sequence is what decides whether two touching bands can be told apart. Two of
 * the tokens are the app's warning amber and its danger red, which are ΔE 2.9
 * apart for a deuteranope and cannot be moved (see globals.css); this order
 * keeps them four steps away from each other, and with them separated the worst
 * adjacent pair over the whole rotation is ΔE 35 in the light theme and 28 in
 * the dark one.
 *
 * Pink leads because it is the section's own colour, and the red is spent last,
 * so a chart of two or three series is never mostly alarm-coloured.
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

/**
 * The eighth, kept out of the rotation.
 *
 * For the bucket that is an absence rather than a thing: rows carrying no cost
 * centre, the "övriga" tail a top-six chart sweeps the rest into. Giving those
 * a hue of their own would say they are one more committee, and they are not.
 */
export const CHART_NEUTRAL = "var(--chart-8)";

/** How many series can be told apart before a chart should start grouping. */
export const CHART_SERIES_COUNT = CHART_SERIES.length;

/**
 * The colour for the nth series.
 *
 * Wraps rather than running out, because a chart that hands back `undefined`
 * paints an invisible band. A caller with more series than colours should be
 * grouping the tail into `CHART_NEUTRAL` instead of relying on this, which is
 * what the cost centre charts do.
 */
export function seriesColor(index: number): string {
  return CHART_SERIES[((index % CHART_SERIES.length) + CHART_SERIES.length) % CHART_SERIES.length];
}

/**
 * The five drink types, mapped onto the shared palette.
 *
 * Their own five tokens, named after the drinks, are gone. What is kept from
 * them is the association where the palette allows one, since it is what makes
 * the stacked chart readable before its legend is: beer takes the amber, wine
 * the pink, spirits the blue.
 *
 * Not `CHART_SERIES`' order, because these five are not handed out in sequence:
 * they stack in `CATEGORIES` order (lib/domain/categories.ts), and what matters
 * is which of them end up touching in *that* order. Of every assignment that
 * keeps the three associations above, this is the one whose closest pair is
 * furthest apart: ΔE 13.2 between any two of the five, under either theme and
 * both dichromacies.
 */
export const DRINK_SERIES: Record<DrinkCategory, string> = {
  OL: "var(--chart-4)", // amber
  OVRIG_JASTDRYCK: "var(--chart-2)", // purple
  VIN: "var(--chart-1)", // pink
  SPRITDRYCK: "var(--chart-6)", // indigo
  ALKOHOLDRYCKSLIKNANDE: "var(--chart-7)", // teal
};
