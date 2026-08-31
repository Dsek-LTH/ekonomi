// The voucher a day of takings would be posted as, and whether it may be.
//
// Lifted out of review-client.tsx, where it sat at line 305 of sixteen hundred
// inside the component that draws the screen. It is the piece of that file that
// decides whether money is written to the ledger: `canBook` is what the button
// reads and what the request is checked against, so a mistake in it is a
// voucher the section posts or a day it cannot close. That is not a thing to
// keep somewhere it can only be read by scrolling past six hundred lines of
// markup, and it is not a thing to leave untested.
//
// Pure over plain data. Wording arrives already translated, because a module
// that decides what balances has no business knowing what language anybody
// reads, and because that is what lets the whole of it be tested without a
// React tree.
import {
  filledVoucherRows,
  makeVoucherRow,
  type VoucherEditorRow,
  type VoucherLockedRow,
} from "@/components/voucher-editor";
import { oreToSEK, parseOre, sekToOre } from "@/lib/domain/money";
import { voucherBalance, voucherBlocker, type VoucherBlocker } from "@/lib/domain/voucher";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";

/** One line of the voucher as it goes to the booking route, in öre. */
export interface VoucherLine {
  account: string;
  accountName: string;
  description?: string;
  costCenterCode: string | null;
  debit: number;
  credit: number;
}

export interface VoucherDraft {
  locked: VoucherLockedRow;
  rows: VoucherEditorRow[];
  lines: VoucherLine[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
  blocker: VoucherBlocker | null;
  clearing: string;
  clearingKnown: boolean;
  /** Whether the button may be live: the server applies the same rules. */
  canBook: boolean;
}

/** An account's name from the chart, or the number itself when it is not in it. */
const nameOf = (accounts: AccountRecord[], number: string) =>
  accounts.find((a) => a.number === number)?.name ?? number;

/**
 * Is this day one the section may already have booked?
 *
 * Either because this database has the verifikation, or because Fortnox holds
 * one for the same source, verksamhet and day. Both are shown rather than
 * hidden, since a day missing from the queue cannot be told apart from a day
 * the fetch never covered, and both colour the row.
 */
export const isDuplicate = (r: IncomeReportRow) => Boolean(r.duplicateOf || r.existingVoucher);

/**
 * Where to read a day's intäktsräkning.
 *
 * Stamped with when the report last changed, which makes a corrected day a
 * different address. A draft's PDF is rendered on the way past and the browser
 * is told it may keep it for five minutes: right for stepping back to a day
 * you just looked at, wrong the moment lines are moved on or off it, when the
 * cached copy is a picture of takings that have gone elsewhere.
 */
export const documentUrl = (report: IncomeReportRow) =>
  `/api/income/reports/${report.id}/document?v=${encodeURIComponent(report.updatedAt)}`;

/** Where the money landed, which is a property of how it was paid. */
export const clearingAccountFor = (report: IncomeReportRow, settings: IncomeSettingsRow) =>
  report.source === "SWISH" ? settings.swishClearingAccount : settings.zettleClearingAccount;

/**
 * Which cost centre this day's rows start on.
 *
 * The report's own, if it has one. The import copies the committee's default
 * onto it, and review may have changed it since. Failing that the default
 * itself, because a day fetched before the committee had one would otherwise
 * open with the field blank and refuse to book, with the answer sitting in the
 * settings all along. Fees have no committee, so theirs comes from the setting
 * that decides where Zettle's fees land.
 *
 * The booking route falls back the same way, in the same order, so a day booked
 * without anyone touching it gets exactly what this shows.
 */
export function costCentreFor(report: IncomeReportRow, settings: IncomeSettingsRow): string {
  if (report.costCenterCode) return report.costCenterCode;
  if (report.source === "ZETTLE_FEE") return settings.zettleFeeCostCenterCode ?? "";
  return report.defaultCostCenterCode ?? "";
}

/**
 * The voucher this day would get if nobody touched it: one row per revenue
 * account, the day's cost centre on each.
 *
 * The same rows lib/income/voucher.ts builds on the server, which is what makes
 * the editor a starting point rather than a second opinion. Book without
 * editing and the two agree exactly. Zero-valued accounts are dropped for the
 * same reason they are there: a row for nothing is noise in the ledger.
 */
export function defaultRows(report: IncomeReportRow, settings: IncomeSettingsRow): VoucherEditorRow[] {
  const costCenterCode = costCentreFor(report, settings);

  if (report.source === "ZETTLE_FEE") {
    // A fee is a cost: the fee account is debited and the clearing account,
    // the locked row, is credited.
    return [
      makeVoucherRow({
        account: settings.zettleFeeAccount,
        costCenterCode,
        debit: report.total.toFixed(2),
      }),
    ];
  }

  // One row per revenue account the day's products routed to, summed. The
  // accounts are already on the lines, put there by the prefix routing at
  // import, so nothing here has to guess at one.
  const byAccount = new Map<string, number>();
  for (const line of report.lines) {
    byAccount.set(line.account, (byAccount.get(line.account) ?? 0) + line.total);
  }
  return [...byAccount.entries()]
    .filter(([, total]) => Math.abs(total) >= 0.005)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([account, total]) =>
      makeVoucherRow({
        account,
        costCenterCode,
        // A negative total is a net refund against that account, which is a
        // debit, booked as the row the other way round rather than as a
        // negative credit, which is what a ledger can actually represent.
        credit: total > 0 ? total.toFixed(2) : "",
        debit: total < 0 ? (-total).toFixed(2) : "",
      }),
    );
}

/**
 * The voucher exactly as it will be posted: the locked clearing row, then the
 * edited ones. Both the button's enabled state and the request read this, so
 * the button can only be live for a voucher the server will accept.
 */
export function voucherFor({
  report,
  rows,
  settings,
  accounts,
  costCenters,
  label,
}: {
  report: IncomeReportRow;
  /** The rows as they currently stand, edited, or `defaultRows`. */
  rows: VoucherEditorRow[];
  settings: IncomeSettingsRow;
  accounts: AccountRecord[];
  costCenters: CostCenter[];
  /** Already in the reader's language: this module does not translate. */
  label: { source: string; clearingHint: string; clearingLocked: string };
}): VoucherDraft {
  const clearing = clearingAccountFor(report, settings);
  // Where the money went, from the day's point of view. Takings land in the
  // clearing account (a debit); fees leave it, as does a day that came to a
  // net refund.
  const incoming = report.source !== "ZETTLE_FEE" && report.total >= 0;
  const magnitude = Math.abs(report.total);

  const locked: VoucherLockedRow = {
    account: clearing,
    accountName: nameOf(accounts, clearing),
    description: label.source,
    debit: incoming ? magnitude : 0,
    credit: incoming ? 0 : magnitude,
    hint: label.clearingHint,
    label: label.clearingLocked,
  };

  const lines = [
    {
      account: clearing,
      accountName: nameOf(accounts, clearing),
      // Deliberately none. A clearing account is a bank balance, not a
      // dimension of anybody's budget. A cost centre here would make every
      // committee's outcome count the money twice.
      costCenterCode: null as string | null,
      debit: sekToOre(locked.debit),
      credit: sekToOre(locked.credit),
    },
    // The editor's spare rows are not lines of the voucher. See
    // filledVoucherRows. Sent as they are, every day would be blocked on
    // three rows with no account.
    ...filledVoucherRows(rows).map((r) => ({
      account: r.account.trim(),
      accountName: nameOf(accounts, r.account),
      description: r.description || undefined,
      costCenterCode: r.costCenterCode || null,
      debit: parseOre(r.debit),
      credit: parseOre(r.credit),
    })),
  ];

  // Summed in öre and converted for display. The difference used to be taken
  // between two kronor floats and then compared to 0, which is the comparison
  // lib/domain/voucher.ts exists to keep out of the screens.
  const balance = voucherBalance(lines);
  const totalDebit = oreToSEK(balance.debit);
  const totalCredit = oreToSEK(balance.credit);
  // Two questions. `balanced` is whether the sides meet; `blocker` is whether
  // it may be written at all, which is stricter. An unpicked account blocks a
  // voucher that adds up perfectly well, and the chip should not call that a
  // difference. The same rule the route applies, on the same rows, in the same
  // unit, so the screen and the server cannot disagree.
  const blocker = voucherBlocker(lines);
  const knownAccounts = filledVoucherRows(rows).every((r) =>
    accounts.some((a) => a.number === r.account.trim()),
  );
  const knownCostCenters = filledVoucherRows(rows).every(
    (r) => !r.costCenterCode.trim() || costCenters.some((c) => c.code === r.costCenterCode.trim()),
  );
  // The locked row is nobody's choice here, but it is still an account that
  // has to exist: a clearing account missing from the chart is a settings
  // mistake that would otherwise be found by Fortnox, at export, on a voucher
  // this app had already called booked.
  const clearingKnown = accounts.some((a) => a.number === clearing);

  return {
    locked,
    rows,
    lines,
    totalDebit,
    totalCredit,
    difference: oreToSEK(balance.difference),
    balanced: balance.balanced,
    blocker,
    clearing,
    clearingKnown,
    canBook:
      !blocker &&
      knownAccounts &&
      knownCostCenters &&
      clearingKnown &&
      rows.length > 0 &&
      // Already booked here: the verifikation exists, and a second is refused
      // by the database. A voucher merely in Fortnox is only a warning.
      !report.duplicateOf,
  };
}
