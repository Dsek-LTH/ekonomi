// A kontering written by hand, and how it is kept honest.
//
// Most days book the rows their lines give (lib/income/voucher.ts). Some need
// something else: a project, a row text, an amount split across two cost
// centres in a way no line says. So a day can carry a voucher written by hand
// (IncomeReport.manualVoucher), saved on the server the moment it is saved on
// the screen.
//
// What went wrong before, when the hand-written rows lived in the browser, was
// that they outlived the corrections made after them: a line re-accounted, a
// cost centre changed, and the old rows were booked anyway. Two rules make
// that impossible here:
//
//   - The clearing row is never hand-written. It is the day's total, the
//     figure on the intäktsräkning, so the voucher cannot book a different sum
//     from the document beside it.
//   - The kontering is saved with a fingerprint of the rows the lines gave at
//     that moment (`voucherBasis`). If a line changes afterwards, the two no
//     longer match, the screen says so, and booking refuses until somebody
//     saves the kontering again or resets it.
//
// Pure, so the screen and the routes run the same rules.
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

/**
 * A fingerprint of the voucher the lines give: its rows, in order, with their
 * amounts. Two days whose lines would book the same voucher have the same
 * basis, so a correction that changes nothing about the voucher (a line moved
 * between two units sharing an account and cost centre) leaves the kontering
 * standing, and one that changes anything does not.
 */
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

/**
 * The clearing row for a day: debit what came in, credit a day that came to a
 * net refund. Nothing on a day that nets to zero.
 */
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

/**
 * The rules a hand-written kontering is held to, beyond what each value must
 * exist: every row has an account and an amount, every result row has a cost
 * centre (the bug this whole module started from was income reaching Fortnox
 * without one), and with the clearing row it balances.
 */
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
