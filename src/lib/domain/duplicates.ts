// Is this utlägg one that has already been handed in? The same amount within three days either side
// (the date is typed, so often off by one), from the same person. A warning, never a refusal.

import { sekToOre } from "./money";

export interface ExpenseFingerprint {
  id: string;
  reference?: string;
  title: string;
  /** SEK, signed. */
  grossAmount: number;
  /** YYYY-MM-DD. */
  purchaseDate: string;
}

const DUPLICATE_WINDOW_DAYS = 3;

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
  const ore = sekToOre(claim.grossAmount);
  return existing.filter(
    (e) =>
      e.id !== claim.excludeId &&
      sekToOre(e.grossAmount) === ore &&
      Math.abs(dayOf(e.purchaseDate) - day) <= DUPLICATE_WINDOW_DAYS * DAY,
  );
}
