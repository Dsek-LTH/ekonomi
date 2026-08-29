// What a kilometre is worth, and when.
//
// One rule, written once: the rate in force on a day is the newest one that had
// already started by it. Everything that needs a rate — the form as it totals
// what is being typed, the API as it values a trip it is about to store, the
// admin screen as it shows which row is current — asks this, so a claim cannot
// be worth one thing on screen and another in the database.
//
// Pure over plain data, and client-safe: the wizard imports it directly, which
// is the point of it not touching Prisma.

/** A rate row, as everything here needs it. `validFrom` is an ISO date. */
export interface MileageRateLike {
  orePerKm: number;
  validFrom: string;
}

/**
 * The rate in force on `date`, or null when the table says nothing about a day
 * that early.
 *
 * Null rather than a fallback constant. A trip driven before the first rate was
 * recorded is not worth 25 kr/mil by default — it is a claim nobody can value,
 * and the form has to say so rather than quietly invent a figure that would go
 * on to be paid out.
 *
 * The list need not be sorted; this does not mutate it.
 */
export function rateOn(rates: MileageRateLike[], date: string): MileageRateLike | null {
  let best: MileageRateLike | null = null;
  for (const r of rates) {
    // String comparison is date comparison for ISO dates, and it cannot be
    // thrown off by a timezone the way `new Date(...)` can — the whole reason
    // dates are carried as strings through this half of the app.
    if (r.validFrom <= date && (!best || r.validFrom > best.validFrom)) best = r;
  }
  return best;
}

/**
 * What a distance is worth at a rate, in öre.
 *
 * Rounded half up, which is what everyone means by "öre". One journey per
 * claim, so this is rounded once and there is no sheet of rows for a total to
 * disagree with.
 */
export function distanceOre(km: number, orePerKm: number): number {
  return Math.round(km * orePerKm);
}
