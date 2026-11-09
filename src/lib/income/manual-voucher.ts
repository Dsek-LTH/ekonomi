// A hand-written kontering (IncomeReport.manualVoucher), kept honest by two rules. The clearing row
// is never hand-written (it is the day's total). The kontering is saved with a fingerprint of the
// rows the lines gave (`voucherBasis`): if a line changes afterwards, booking refuses until it is
// saved again or reset. Pure.

import { buildDayVoucherLines, type DayVoucherInputLine } from "./voucher";

/** One hand-written row as it is stored, öre. Never the clearing row. */
export interface ManualVoucherRow {
  account: string;
  accountName: string;
  costCenterId: string | null;
  /** Beside the id, so the screen can show it without another lookup. */
  costCenterCode: string | null;
  project: string | null;
  description: string | null;
  debit: number;
  credit: number;
}

/** A fingerprint of the voucher the lines give (rows in order, with amounts). A correction that changes nothing about it leaves the kontering standing. */
export function voucherBasis(lines: readonly DayVoucherInputLine[], total: number): string {
  const rows = buildDayVoucherLines({
    lines,
    total,
    clearingAccount: "clearing",
    accountName: () => "",
  });
  return [
    String(total),
    ...rows.map((r) => `${r.account}|${r.costCenterId ?? ""}|${r.debit}|${r.credit}`),
  ].join(";");
}

/** A result account, class 3 to 8: what a cost centre is for. */
export const isResultAccount = (account: string) => /^[3-8]\d{3}$/.test(account.trim());

/** The clearing row: debit what came in, credit a net refund day. None on a day that nets to zero. */
export function clearingRow(total: number): { debit: number; credit: number } | null {
  if (total === 0) return null;
  return total > 0 ? { debit: total, credit: 0 } : { debit: 0, credit: -total };
}

/** Why a hand-written kontering cannot be saved or booked. Keys under `income.manual`. */
export type ManualVoucherBlocker =
  | "noRows"
  | "accountRequired"
  | "amountRequired"
  | "negativeAmounts"
  | "costCenterRequired"
  | "unbalanced";

/** Rules beyond field presence: every result row has a cost centre, and with the clearing row it balances. */
export function manualVoucherBlocker(
  rows: readonly { account: string; costCenter: string | null; debit: number; credit: number }[],
  total: number,
): ManualVoucherBlocker | null {
  if (rows.length === 0) return "noRows";
  if (rows.some((r) => !r.account.trim())) return "accountRequired";
  if (rows.some((r) => r.debit === 0 && r.credit === 0)) return "amountRequired";
  if (rows.some((r) => r.debit < 0 || r.credit < 0)) return "negativeAmounts";
  if (rows.some((r) => isResultAccount(r.account) && !r.costCenter)) return "costCenterRequired";
  const clearing = clearingRow(total);
  const debit = rows.reduce((s, r) => s + r.debit, 0) + (clearing?.debit ?? 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0) + (clearing?.credit ?? 0);
  if (debit !== credit) return "unbalanced";
  return null;
}
