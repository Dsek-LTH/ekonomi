// Turning a bottle on a scale into millilitres.
//
// The bar measures a part-used spirit bottle by weighing it. Every product
// records what its bottle weighs empty (`tareGrams`) and full (`fullGrams`),
// and those two weights bracket the bottle's nominal volume — so what is left
// is linear interpolation between them, and no density constant is needed
// anywhere. For a 700 ml 40 % spirit this comes out at roughly 1 g per ml,
// which is the sanity check to make at the scale.
//
// Bottles are anonymous: the bar cannot tell one open bottle of a product from
// another. So a weighing is a *set* of readings, and what it establishes is how
// many bottles are open and how much is in them together — never which bottle
// holds what. That is also why the count is part of the arithmetic: one tare is
// subtracted per bottle, so a pre-summed total could not be converted at all.
//
// Nothing here rounds to a bottle or invents a number for a missing reading. A
// weighing says what was on the scale; anything else is the caller's to decide.

/** What a product needs to record before any of this can be answered. */
export interface Calibration {
  /** The bottle as sold, in millilitres. */
  nominalMl: number;
  /** An empty bottle, in grams. */
  tareGrams: number;
  /** A sealed bottle, in grams. */
  fullGrams: number;
}

/**
 * Why a calibration cannot be used. Each is a message key under
 * `errors.stock` — the route answers with it and the admin screen shows the
 * same sentence, the way `voucherBlocker` does for a verifikation.
 */
export type CalibrationFault =
  | "calibrationMissing"
  | "calibrationNotHeavier"
  | "calibrationNoVolume";

/**
 * Whether a product's three constants can convert anything, or why not.
 *
 * Checked rather than assumed because every figure downstream is derived from
 * them: a full weight below the tare would silently produce negative stock, and
 * a zero nominal volume would divide by nothing. A wrong constant here is worse
 * than a missing one — it is a plausible number in the legal record.
 */
export function calibrationFault(
  c: Partial<Calibration> | null | undefined,
): CalibrationFault | null {
  if (
    !c ||
    c.nominalMl == null ||
    c.tareGrams == null ||
    c.fullGrams == null ||
    !Number.isFinite(c.nominalMl) ||
    !Number.isFinite(c.tareGrams) ||
    !Number.isFinite(c.fullGrams)
  ) {
    return "calibrationMissing";
  }
  if (c.nominalMl <= 0) return "calibrationNoVolume";
  // A full bottle weighs more than an empty one. Equal is just as unusable —
  // it would divide by zero.
  if (c.fullGrams <= c.tareGrams) return "calibrationNotHeavier";
  return null;
}

/** Grams of liquid a full bottle holds, which is the scale of the whole thing. */
export const contentGrams = (c: Calibration): number => c.fullGrams - c.tareGrams;

/**
 * What a set of weighed bottles holds, in millilitres.
 *
 * `readings` is one weight per bottle on the scale, in grams. The result is
 * rounded to a whole millilitre because that is the resolution anything
 * downstream reports in, and because a fraction of a millilitre is far below
 * what a bottle's glass varies by anyway.
 *
 * Never negative. A bottle can read below its tare — a scale that drifted, a
 * tare measured on a heavier bottle from an older delivery — and the honest
 * answer to "how much is in it" is then nothing, not a negative volume that
 * would quietly cancel out real stock elsewhere in the sum.
 */
export function readingsToMl(readings: readonly number[], c: Calibration): number {
  if (readings.length === 0) return 0;
  const liquid = readings.reduce((sum, g) => sum + g, 0) - readings.length * c.tareGrams;
  const ml = (c.nominalMl * liquid) / contentGrams(c);
  return Math.max(0, Math.round(ml));
}

/** The same, for a single bottle — the common case, and clearer at the call site. */
export const readingToMl = (grams: number, c: Calibration): number =>
  readingsToMl([grams], c);

/**
 * How far a reading is from what the bottle could possibly hold, as a fraction
 * of a full one. 1.0 is exactly full, 1.08 is eight per cent over.
 *
 * Suppliers change their glass without telling anybody, and when they do, every
 * bottle of that product starts reading heavy. This is what lets a screen say
 * so — see `implausibleReading` — instead of booking more vodka than the bottle
 * can contain and leaving somebody to find it in a stocktake months later.
 */
export const fullness = (grams: number, c: Calibration): number =>
  (grams - c.tareGrams) / contentGrams(c);

/**
 * How much over or under full a reading may be before it is worth questioning.
 *
 * Eight per cent of a 700 ml bottle is 56 ml — comfortably more than the ±5–10 g
 * that glass varies by within one product, and comfortably less than the jump a
 * changed bottle design makes. Wide enough not to cry wolf on a full bottle,
 * narrow enough to catch a tare that belongs to a different bottle.
 */
export const READING_TOLERANCE = 0.08;

/**
 * Whether a reading is one somebody should look at before it is written down.
 *
 * A warning, never a refusal: the scale is the evidence and this code is not in
 * a position to overrule it. What it must not do is let a plainly impossible
 * number through in silence.
 */
export function implausibleReading(grams: number, c: Calibration): boolean {
  const f = fullness(grams, c);
  return f > 1 + READING_TOLERANCE || f < -READING_TOLERANCE;
}
