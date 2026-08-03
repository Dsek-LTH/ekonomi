// When a verifikation may be written, and why not.
//
// The same shape as `submitBlocker` in ./status.ts, and for the same reason:
// the booking screen has to know whether the "Bokför" button is live and the
// route has to refuse a voucher that shouldn't exist, and those two are one
// rule. They used to be two — the server counting in öre, the screen counting
// in kronor with a `round2` to paper over the floats — which is exactly how a
// button ends up live for a voucher the server then rejects.
//
// Amounts are öre, which is what makes "debet = kredit" an integer comparison
// and not a tolerance. See ./money.ts: the database holds öre, the interface
// shows kronor, and a rule about whether two sums are equal belongs on the side
// where they can actually be equal.

/** One row of a verifikation. `account` is a BAS number; amounts are öre. */
export interface VoucherLine {
  account: string;
  debit: number;
  credit: number;
}

/**
 * Why this voucher can't be written, or null when it can. Each value is a
 * message key under `errors.voucher` — the route returns it as its error code
 * and the screen shows the same sentence.
 */
export type VoucherBlocker =
  | "twoLines"
  | "accountRequired"
  | "negativeAmounts"
  | "unbalanced";

export function voucherBlocker(lines: readonly VoucherLine[]): VoucherBlocker | null {
  // Double entry: one row is not a verifikation, whatever it says.
  if (lines.length < 2) return "twoLines";
  if (lines.some((l) => !l.account.trim())) return "accountRequired";
  // A return is booked with the rows the other way round, not with a negative
  // amount, so a negative here is always a mistake.
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) return "negativeAmounts";

  const debit = lines.reduce((s, l) => s + l.debit, 0);
  const credit = lines.reduce((s, l) => s + l.credit, 0);
  // The zero check is what stops an empty voucher (0 = 0) counting as balanced;
  // beyond that, balance is exact.
  if (debit === 0 || debit !== credit) return "unbalanced";
  return null;
}
