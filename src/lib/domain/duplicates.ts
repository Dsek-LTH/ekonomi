// Is this utlägg one that has already been handed in?
//
// The usual mistake is the same receipt twice: photographed again a week later
// because the first one seemed not to have gone through, or once as a draft and
// again from scratch. What gives it away is the same amount on (nearly) the
// same day, from the same person. Three days either side, because the date is
// typed and the second time it is often typed off by one.
//
// A warning, never a refusal. Two pizzas on one evening is not a mistake, and
// only the person filling this in knows which it is.

export interface ExpenseFingerprint {
  id: string;
  reference?: string;
  title: string;
  /** SEK, signed. */
  grossAmount: number;
  /** YYYY-MM-DD. */
  purchaseDate: string;
}

export const DUPLICATE_WINDOW_DAYS = 3;

const DAY = 24 * 60 * 60 * 1000;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

export function likelyDuplicates(
  existing: readonly ExpenseFingerprint[],
  claim: { grossAmount: number; purchaseDate: string; excludeId?: string | null },
): ExpenseFingerprint[] {
  if (!claim.grossAmount || !claim.purchaseDate) return [];
  const day = dayOf(claim.purchaseDate);
  if (Number.isNaN(day)) return [];
  // In öre, so a float's last digit cannot make 320 differ from 320.
  const ore = Math.round(claim.grossAmount * 100);
  return existing.filter(
    (e) =>
      e.id !== claim.excludeId &&
      Math.round(e.grossAmount * 100) === ore &&
      Math.abs(dayOf(e.purchaseDate) - day) <= DUPLICATE_WINDOW_DAYS * DAY,
  );
}
