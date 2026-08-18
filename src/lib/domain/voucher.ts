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
  | "amountRequired"
  | "negativeAmounts"
  | "unbalanced";

/**
 * The two sides, and what stands between them. Öre.
 *
 * Balance is a narrower question than `voucherBlocker`, and worth asking on its
 * own: a voucher with a half-filled row, or one account still unpicked, can be
 * perfectly balanced — it simply cannot be *booked* yet. The booking screens
 * used to read "balanced" off the blocker, which conflated the two and put a
 * red "differs by 0,00 kr" under a voucher whose sides met exactly. What the
 * blocker says is whether it may be written; what this says is whether it adds
 * up, and the screens want both.
 */
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
    // The zero check is what stops an empty voucher (0 = 0) counting as
    // balanced — an untouched form would otherwise open on a green chip.
    // Beyond that, balance is exact.
    balanced: debit !== 0 && debit === credit,
  };
}

export function voucherBlocker(lines: readonly VoucherLine[]): VoucherBlocker | null {
  // Double entry: one row is not a verifikation, whatever it says.
  if (lines.length < 2) return "twoLines";
  if (lines.some((l) => !l.account.trim())) return "accountRequired";
  // An account with nothing posted to it is not a row of anything. It reaches
  // here because the editors only discard a row that is empty *all through*
  // (isBlankVoucherRow) — an account picked and then left, which is what a
  // half-finished thought looks like, counts as typed and travels the whole way
  // to Fortnox as a 0,00 line nobody meant to write.
  //
  // Ahead of the balance check on purpose: a voucher of nothing but these adds
  // to 0 = 0, and "debet ≠ kredit" is a poor way to say "you left the amounts
  // out" to someone looking at two sides that plainly match.
  if (lines.some((l) => l.debit === 0 && l.credit === 0)) return "amountRequired";
  // A return is booked with the rows the other way round, not with a negative
  // amount, so a negative here is always a mistake.
  if (lines.some((l) => l.debit < 0 || l.credit < 0)) return "negativeAmounts";
  // Asked through the same function the chip uses, so the button and the chip
  // cannot end up disagreeing about what balancing means.
  if (!voucherBalance(lines).balanced) return "unbalanced";
  return null;
}
