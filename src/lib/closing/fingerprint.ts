// A short string of what a voucher said, so a review can tell which version it reviewed. Series and number survive a sync, but Fortnox reuses numbers.
// Computed from LedgerRow columns so the sync and a reader get the same value.
import { createHash } from "node:crypto";

export interface FingerprintRow {
  account: string;
  costCenterCode: string | null;
  text: string | null;
  debit: number;
  credit: number;
}

/** Rows are sorted first (order says nothing about what was booked). `project` is excluded: the SIE sync leaves it null, and adding it later would unreview every voucher. */
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
