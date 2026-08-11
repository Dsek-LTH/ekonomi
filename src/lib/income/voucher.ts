// Turning an income report into the rows of a verifikation.
//
// Income is the mirror image of an utlägg. An expense debits a cost account and
// credits what paid for it; a day's takings credit each revenue account the
// products routed to, and debit the account the money actually landed in — the
// Zettle or Swish clearing account, depending on how it was paid.
//
// Zettle's own fees are the odd one out: they are a cost, so they go the other
// way round, debiting the fee account and crediting the same clearing account
// the takings were debited to.
//
// Amounts are öre throughout, which is what makes "debit equals credit" an
// integer comparison rather than a tolerance — see lib/domain/voucher.ts, whose
// `voucherBlocker` this feeds and which is the same rule the expense booking
// screen is held to.
import type { VoucherLine } from "@/lib/domain/voucher";
import type { IncomeSource } from "@/lib/domain/types";
import type { IncomeAccountDistribution, IncomeFeeReportDto } from "./types";

/**
 * What the verifikation says it is: "IR Swish - Café", "Zettleavgifter".
 *
 * One function because this text has two jobs. It is the description the
 * voucher carries into Fortnox — and, together with the date, it is the only
 * thing that identifies a day's takings once they are over there: Fortnox
 * knows nothing about reports, batches or committees. The duplicate check
 * (lib/income/duplicate.ts) matches on exactly this string, so it must be
 * computed the same way wherever it is needed, and changing it means older
 * exports stop being recognised.
 */
export function incomeVoucherDescription(
  source: IncomeSource,
  committeeDescription: string | null,
): string {
  if (source === "ZETTLE_FEE") return "Zettleavgifter";
  const payment = source === "SWISH" ? "Swish" : "Zettle";
  return `IR ${payment} - ${committeeDescription ?? ""}`.trim();
}

/**
 * Which verifikationsserie a day's takings are filed under in Fortnox.
 *
 * A setting of its own, falling back to the series everything else uses. A
 * section that books a term of Swish gets a hundred vouchers in a fortnight,
 * and interleaving those with the utlägg makes both harder to read over there;
 * one that has no opinion should not have to have one, which is why the setting
 * is nullable and this exists rather than a default in the column.
 *
 * The reason it is a function in this file and not two reads at two call sites:
 * the series is half of how a day is *recognised* in Fortnox — the duplicate
 * check matches on series, date and voucher text (lib/income/duplicate.ts) —
 * so a check reading one series while the export writes another would report
 * every day as new and write it twice.
 */
export function incomeVoucherSeries(
  settings: { incomeVoucherSeries: string | null } | null,
  connectionSeries: string,
): string {
  return settings?.incomeVoucherSeries?.trim() || connectionSeries;
}

/**
 * The key intakt files a unit's reports under, derived from its name.
 *
 * Nobody types this any more. It used to be a field on the settings screen —
 * a second identifier to invent and keep in step with the name — and the name
 * itself cannot take its place: a name is prose someone may reword, while this
 * is an identifier another program groups by, so a rename would silently
 * re-route every future report. Derived once when a unit is given income
 * settings, then never changed.
 *
 * Diacritics are folded and everything else dropped, because this crosses a
 * JSON contract into a service that uses it as a map key and in filenames:
 * "Sexmästeriet" → "sexmasteriet", "D-shopen" → "dshopen".
 */
export function incomeKeyFromName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 32);
}

/**
 * The fingerprint a day's takings have in Fortnox: the day, and what the
 * voucher says it is. Those are the only two things that cross over — Fortnox
 * knows nothing about reports, sources or batches.
 *
 * The payment method is part of it, because it is part of the description:
 * "IR Swish - Café" and "IR Zettle - Café" are two different days' work that
 * happen to share a date and a verksamhet, and neither is evidence that the
 * other has been booked. Only the same source, the same verksamhet and the same
 * day are the same takings.
 *
 * Case- and space-insensitive: this app writes the descriptions it compares,
 * but the ones already over there were written by whatever wrote them, and a
 * voucher that differs by a double space is not a different day.
 */
export function incomeVoucherKey(date: string, description: string): string {
  return `${date}|${description.trim().replace(/\s+/g, " ").toLowerCase()}`;
}

/** A line as it is stored: a VoucherLine plus what goes in the ledger beside it. */
export interface IncomeVoucherLine extends VoucherLine {
  accountName: string;
  /** Null on the clearing row — see below. */
  costCenterId: string | null;
  sortOrder: number;
}

export interface IncomeVoucherInput {
  distributions: readonly IncomeAccountDistribution[];
  /** The report's total in öre; must equal the distributions' sum. */
  total: number;
  /** Where the money landed: the Zettle or Swish clearing account. */
  clearingAccount: string;
  clearingAccountName: string;
  /** Cost centre for the revenue rows. Null until one is chosen. */
  costCenterId: string | null;
  accountName: (account: string) => string;
}

/**
 * Why these takings cannot be booked, or null when they can.
 *
 * `unbalanced` is the one worth explaining: the service computes the
 * distributions and the total independently, and a report where they disagree
 * is one whose voucher would be rejected by Fortnox — but only at export, long
 * after the app had said it was booked. Better to refuse it here.
 */
export type IncomeVoucherBlocker =
  | "noDistributions"
  | "unbalanced"
  | "noClearingAccount"
  | "noCostCenter";

export function incomeVoucherBlocker(input: IncomeVoucherInput): IncomeVoucherBlocker | null {
  const usable = input.distributions.filter((d) => d.total !== 0);
  if (usable.length === 0) return "noDistributions";
  if (!input.clearingAccount.trim()) return "noClearingAccount";
  if (!input.costCenterId) return "noCostCenter";

  const distributed = usable.reduce((sum, d) => sum + d.total, 0);
  if (distributed !== input.total || input.total === 0) return "unbalanced";

  return null;
}

/**
 * The voucher rows for a day's takings.
 *
 * Zero-valued distributions are dropped rather than written: a row for nothing
 * is noise in the ledger, and Fortnox rejects some of them outright. They can
 * legitimately occur — a product sold and then fully refunded on the same day
 * nets to zero against its account.
 */
export function buildIncomeVoucherLines(input: IncomeVoucherInput): IncomeVoucherLine[] {
  const revenue = input.distributions
    .filter((d) => d.total !== 0)
    // Stable order, so two vouchers for the same shape of day read the same.
    .toSorted((a, b) => a.account.localeCompare(b.account))
    .map((d, i) => ({
      account: d.account,
      accountName: input.accountName(d.account),
      // A negative distribution is a net refund against that account, which is
      // a debit — booked as the row the other way round rather than as a
      // negative credit, which is what a ledger can actually represent.
      debit: d.total < 0 ? -d.total : 0,
      credit: d.total > 0 ? d.total : 0,
      costCenterId: input.costCenterId,
      sortOrder: i,
    }));

  const total = revenue.reduce((sum, r) => sum + r.credit - r.debit, 0);

  return [
    ...revenue,
    {
      account: input.clearingAccount,
      accountName: input.clearingAccountName,
      // The counter-row: what the revenue rows credit, this debits.
      debit: total > 0 ? total : 0,
      credit: total < 0 ? -total : 0,
      // Deliberately none. A clearing account is a bank balance, not a
      // dimension of anybody's budget — putting a cost centre on it would make
      // every committee's outcome count the money twice.
      costCenterId: null,
      sortOrder: revenue.length,
    },
  ];
}

export interface FeeVoucherInput {
  report: IncomeFeeReportDto;
  /** Debited: Zettle's fees are a cost to the section.  */
  feeAccount: string;
  feeAccountName: string;
  /** Credited: the money never arrived, so the clearing account is reduced. */
  clearingAccount: string;
  clearingAccountName: string;
  costCenterId: string | null;
}

/**
 * The two rows a day of Zettle fees becomes.
 *
 * Fees arrive from Zettle as negative amounts and the service already stores
 * them as a positive cost, so nothing here flips a sign.
 */
export function buildFeeVoucherLines(input: FeeVoucherInput): IncomeVoucherLine[] {
  const total = input.report.total;
  return [
    {
      account: input.feeAccount,
      accountName: input.feeAccountName,
      debit: total,
      credit: 0,
      costCenterId: input.costCenterId,
      sortOrder: 0,
    },
    {
      account: input.clearingAccount,
      accountName: input.clearingAccountName,
      debit: 0,
      credit: total,
      costCenterId: null,
      sortOrder: 1,
    },
  ];
}
