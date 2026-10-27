// What a voucher said, as one short string, so that a review can say which
// version of a voucher it was a review of.
//
// A review is keyed on the voucher's series and number, because that is what
// survives a sync (the rows are deleted and re-inserted with new ids every
// time). A number is not enough on its own, though: Fortnox lets the latest
// vouchers in a series be deleted and their numbers used again, so A-12 today
// may not be the A-12 somebody reviewed. The fingerprint is what tells them
// apart. Same fingerprint, same voucher; anything else is a voucher nobody has
// reviewed yet.
//
// Computed from the ledger's own columns, in the shape LedgerRow stores them,
// so that the sync (which has the rows before they are written) and a reader
// (which has them after) arrive at the same value.
import { createHash } from "node:crypto";

export interface FingerprintRow {
  account: string;
  costCenterCode: string | null;
  text: string | null;
  /** öre */
  debit: number;
  /** öre */
  credit: number;
}

/**
 * The fingerprint of one voucher.
 *
 * The rows are sorted first. Their order says nothing about what was booked,
 * and an export that hands them back in a different order is the same voucher.
 *
 * `project` is deliberately not part of it. The SIE sync does not carry it
 * today, so it is null on every row, and starting to carry it later would
 * change every fingerprint in the ledger and send every review back to
 * unreviewed at once.
 */
export function voucherFingerprint(voucher: {
  date: string;
  description: string;
  rows: readonly FingerprintRow[];
}): string {
  const rows = voucher.rows
    .map((r) => [r.account, r.costCenterCode ?? "", r.text ?? "", r.debit, r.credit] as const)
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const canonical = JSON.stringify([voucher.date, voucher.description, rows]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
