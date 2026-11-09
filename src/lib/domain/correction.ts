// Corrections at the kontering: a bokförare fixing an attested utlägg's date in place instead of
// sending it back (api/expenses/[id]/book). The utlägg is corrected, not only the voucher. It still
// counts against the submitter and attesters like a send-back after full attest (lib/domain/member-score.ts),
// with no mail. Amount, cost centre and payment type are not correctable: the attesters signed for them.

export type CorrectedField = "purchaseDate";

export interface CorrectionDiff {
  field: CorrectedField;
  from: string | null;
  to: string | null;
}

export function correctionOf(diff: unknown): CorrectionDiff | null {
  const d = diff as Partial<CorrectionDiff> | null;
  if (!d || d.field !== "purchaseDate") return null;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return { field: d.field, from: str(d.from), to: str(d.to) };
}

/** Whether this correction counts against the submitter and the attesters. Every one does today. */
export const isFaultedCorrection = (c: CorrectionDiff | null): boolean =>
  c?.field === "purchaseDate";
