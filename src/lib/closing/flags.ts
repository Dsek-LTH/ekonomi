// What about a voucher is worth a second look, worked out from the ledger and
// the app's own records. Each is a reason to open the voucher, not a verdict on
// it: a flagged voucher can be perfectly right.
import type { VoucherEvidence } from "./evidence";

export const VOUCHER_FLAGS = [
  /** Dated outside the financial year it is booked in. */
  "outsideYear",
  /** Another voucher in the year has the same date and the same amount. */
  "possibleDuplicate",
  /** An utlägg filed after the deadline on a dispens. */
  "deadlineWaived",
  /** The utlägg was konterat and bokfört by the same person. */
  "ownBooking",
] as const;
export type VoucherFlag = (typeof VOUCHER_FLAGS)[number];

interface Flaggable {
  key: string;
  date: string;
  /** Any unit, as long as all of them use the same one. */
  amount: number;
  evidence: VoucherEvidence;
}

/** Every voucher's flags, by key. A voucher with none is left out. */
export function flagVouchers(
  vouchers: readonly Flaggable[],
  year: { fromDate: string; toDate: string },
): Map<string, VoucherFlag[]> {
  const sameDayAndAmount = new Map<string, number>();
  for (const v of vouchers) {
    // A voucher of nothing (a correction netting to zero) is not a payment
    // that could have been made twice.
    if (v.amount === 0) continue;
    const k = `${v.date}|${v.amount}`;
    sameDayAndAmount.set(k, (sameDayAndAmount.get(k) ?? 0) + 1);
  }

  const flags = new Map<string, VoucherFlag[]>();
  for (const v of vouchers) {
    const own: VoucherFlag[] = [];
    if (v.date < year.fromDate || v.date > year.toDate) own.push("outsideYear");
    if (v.amount !== 0 && (sameDayAndAmount.get(`${v.date}|${v.amount}`) ?? 0) > 1) {
      own.push("possibleDuplicate");
    }
    if (v.evidence.kind === "expense") {
      if (v.evidence.deadlineWaived) own.push("deadlineWaived");
      if (v.evidence.ownBooking) own.push("ownBooking");
    }
    if (own.length) flags.set(v.key, own);
  }
  return flags;
}
