// The rate in force on a day is the newest one already started by it. Pure and client-safe (the wizard imports it).

/** A rate row, as everything here needs it. `validFrom` is an ISO date. */
export interface MileageRateLike {
  orePerKm: number;
  validFrom: string;
}

/** The rate in force on `date`, or null for a day before the first rate (never a fallback constant). Does not mutate the list. */
export function rateOn(rates: MileageRateLike[], date: string): MileageRateLike | null {
  let best: MileageRateLike | null = null;
  for (const r of rates) {
    // String comparison is date comparison for ISO dates and avoids timezone shifts from `new Date(...)`.
    if (r.validFrom <= date && (!best || r.validFrom > best.validFrom)) best = r;
  }
  return best;
}

/** What a distance is worth at a rate, in öre, rounded half up. */
export function distanceOre(km: number, orePerKm: number): number {
  return Math.round(km * orePerKm);
}
