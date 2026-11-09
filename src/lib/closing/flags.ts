// Reasons to open a voucher, not verdicts: a flagged voucher can be right.
import type { VoucherEvidence } from "./evidence";

export const VOUCHER_FLAGS = [
  "outsideYear",
  "possibleDuplicate",
  "deadlineWaived",
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

export function flagVouchers(
  vouchers: readonly Flaggable[],
  year: { fromDate: string; toDate: string },
): Map<string, VoucherFlag[]> {
  const sameDayAndAmount = new Map<string, number>();
  for (const v of vouchers) {
    // A voucher of nothing (a correction netting to zero) could not have been paid twice.
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
