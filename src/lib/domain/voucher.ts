// When a verifikation may be written, and why not. Same shape as `submitBlocker` in ./status.ts: the
// booking screen and the route share one rule. Amounts are öre so "debet = kredit" is an integer
// comparison (./money.ts).

/** One row of a verifikation. `account` is a BAS number; amounts are öre. */
export interface VoucherLine {
  account: string;
  debit: number;
  credit: number;
}

/** Why this voucher can't be written, or null. A message key under `errors.voucher`, used as the route's error code and the screen's sentence. */
export type VoucherBlocker =
  "twoLines" | "accountRequired" | "amountRequired" | "negativeAmounts" | "unbalanced";

/** The two sides, and what stands between them, in öre. Balance is narrower than `voucherBlocker`: a half-filled voucher can balance yet not be bookable. */
export function voucherBalance(lines: readonly VoucherLine[]): {
  debit: number;
  credit: number;
  difference: number;
  balanced: boolean;
} {
  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  return {
    debit,
    credit,
    difference: debit - credit,
    // The zero check stops an empty voucher (0 = 0) counting as balanced. Beyond that, balance is exact.
    balanced: debit !== 0 && debit === credit,
  };
}

export function voucherBlocker(lines: readonly VoucherLine[]): VoucherBlocker | null {
  if (lines.length < 2) return "twoLines";
  if (lines.some((l) => !l.account.trim())) return "accountRequired";
  // An account with nothing posted is not a row: editors only discard rows empty all through
  // (isBlankVoucherRow), so a picked-then-left account would reach Fortnox as a 0,00 line. Checked
  // ahead of the balance check, since such a voucher adds to 0 = 0.
  if (lines.some((l) => l.debit === 0 && l.credit === 0)) return "amountRequired";
  // A return is booked with the rows the other way round, so a negative here is always a mistake.
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) return "negativeAmounts";
  // Asked through the same function the chip uses, so button and chip agree about balance.
  if (!voucherBalance(lines).balanced) return "unbalanced";
  return null;
}

/** A revenue account: BAS class 3, 3000 to 3999. An utlägg's rows may not land there, since a cost posted there nets against sales and hides both. Not part of `voucherBlocker`, which both sides share. */
export const isRevenueAccount = (account: string) => /^3\d{3}$/.test(account.trim());
