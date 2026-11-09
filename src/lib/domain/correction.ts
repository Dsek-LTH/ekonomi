// Corrections at the kontering: a bokförare fixing an attested utlägg's date
// in place instead of sending it back.
//
// Sending an utlägg back for a wrong date costs everybody a round trip: the
// submitter has to open it, change one field and send it again, and every
// attester has to sign it a second time. So the bokförare may correct the date
// themselves, at the kontering (see api/expenses/[id]/book).
//
// The utlägg is corrected, not only the voucher. A voucher dated one day for an
// utlägg that says another is two records disagreeing about one purchase, and
// nobody reading either can tell which is right.
//
// A wrong date is still a mistake somebody let through, so it counts against
// the submitter and the attesters exactly as a send-back after full attest
// would (lib/domain/member-score.ts). Nobody is mailed about it: it shows in
// the utlägg's history and in the score's breakdown.
//
// Nothing else on the utlägg is correctable this way. Amount, cost centre and
// payment type are what the attesters signed for, and changing them without a
// new signature would make the attest mean less.

/** The fields a bokförare may correct on an attested utlägg. */
export type CorrectedField = "purchaseDate";

/** What a CORRECTED event stores in `diff`. */
export interface CorrectionDiff {
  field: CorrectedField;
  from: string | null;
  to: string | null;
}

/** The CORRECTED event's diff, or null for one that does not hold one. */
export function correctionOf(diff: unknown): CorrectionDiff | null {
  const d = diff as Partial<CorrectionDiff> | null;
  if (!d || d.field !== "purchaseDate") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return { field: d.field, from: str(d.from), to: str(d.to) };
}

/** Whether this correction counts against the submitter and the attesters.
 *  Every one does today; the question stays so the score reads one rule. */
export const isFaultedCorrection = (c: CorrectionDiff | null): boolean =>
  c?.field === "purchaseDate";
