// Turning a day's takings into the rows of a verifikation.
//
// Income is the mirror image of an utlägg. An expense debits a cost account and
// credits what paid for it; a day's takings credit each revenue account the
// products routed to, and debit the account the money actually landed in, the
// Zettle or Swish clearing account, depending on how it was paid.
//
// One voucher per day and source. Every verksamhet that sold something that
// day is on it, and each sold line carries its own cost centre, so a row of the
// voucher is an (account, cost centre) pair summed over the lines that share
// it. Zettle's fees are lines of the same day, on the fee account: they come
// out of the same clearing account the takings went into, which is why Zettle
// pays out what it does.
//
// Amounts are öre throughout, which is what makes "debit equals credit" an
// integer comparison rather than a tolerance. See lib/domain/voucher.ts, whose
// `voucherBlocker` this feeds and which is the same rule the expense booking
// screen is held to.
import type { VoucherLine } from "@/lib/domain/voucher";
import type { IncomeSource } from "@/lib/domain/types";

/**
 * What the verifikation says it is: "Zettle", "Swish".
 *
 * The payment method and nothing else, because the voucher is the whole day's
 * takings for that method, every verksamhet on it. Together with the date it
 * is how a day is recognised in Fortnox, which knows nothing about reports or
 * batches (lib/income/duplicate.ts).
 *
 * Days booked before the per-day voucher said whose they were, "Swish - Café",
 * and Zettle's fees had a voucher of their own, "Zettleavgifter". Those are
 * still in Fortnox, which is why the duplicate check matches on the method a
 * description starts with (`incomeVoucherCoversDay`) rather than on this text.
 */
export function incomeVoucherDescription(source: IncomeSource): string {
  return source === "SWISH" ? "Swish" : "Zettle";
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
 * the series is half of how a day is *recognised* in Fortnox. The duplicate
 * check matches on series, date and voucher text (lib/income/duplicate.ts),
 * so a check reading one series while the export writes another would report
 * every day as new and write it twice.
 */
export function incomeVoucherSeries(
  settings: { incomeVoucherSeries: string | null } | null,
  connectionSeries: string | null,
): string | null {
  return settings?.incomeVoucherSeries?.trim() || connectionSeries;
}

/**
 * The key a unit's reports are grouped under, derived from its name.
 *
 * Nobody types this any more. It used to be a field on the settings screen,
 * a second identifier to invent and keep in step with the name, and the name
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
 * voucher says it is. Those are the only two things that cross over. Fortnox
 * knows nothing about reports, sources or batches.
 *
 * The payment method is part of it, because it is part of the description:
 * "Swish - Café" and "Zettle - Café" are two different days' work that happen
 * to share a date and a verksamhet, and neither is evidence that the other has
 * been booked. Only the same source, the same verksamhet and the same day are
 * the same takings.
 *
 * Case- and space-insensitive: this app writes the descriptions it compares,
 * but the ones already over there were written by whatever wrote them, and a
 * voucher that differs by a double space is not a different day.
 *
 * A leading "IR" goes the same way, and that one is load-bearing. Descriptions
 * were written as "IR Swish - Café" until the prefix was dropped, so the two
 * wordings are in play at once and in every combination: Fortnox holds old
 * vouchers and new ones, and a report booked before the change still carries
 * the old text locally, which is what the export re-checks with, rather than
 * recomputing it. Folding the prefix away here is what makes all four
 * comparisons agree, and it is the only place they meet.
 */
export function incomeVoucherKey(date: string, description: string): string {
  const text = description
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    // Anchored, and only when something follows it: a verksamhet whose name
    // starts with these two letters is not a prefix.
    .replace(/^ir[\s-]+/, "");
  return `${date}|${text}`;
}

/**
 * Whether a voucher already in Fortnox books the same source's takings on its
 * date, judged by its description.
 *
 * By the method it starts with, not by equality, because three generations of
 * wording are over there at once: "Zettle" for a whole day, "Zettle - Café" for
 * one verksamhet's day before that, "Zettleavgifter" for a day's fees, and any
 * of them with the old "IR " in front. Every one of them means some of this
 * day's Zettle money is already booked, so booking the whole day again would
 * count it twice. The reviewer is shown which voucher it was.
 */
export function incomeVoucherCoversDay(source: IncomeSource, description: string): boolean {
  const text = incomeVoucherKey("", description).slice(1);
  return source === "SWISH" ? /^swish\b/.test(text) : /^zettle/.test(text);
}

/** One line of a day as the voucher reads it. */
export interface DayVoucherInputLine {
  account: string;
  costCenterId: string | null;
  /** What the line adds to the clearing account, öre. Negative for a fee. */
  total: number;
}

/** A row of the verifikation, as it is stored. */
export interface IncomeVoucherLine extends VoucherLine {
  accountName: string;
  /** Null on the clearing row. See below. */
  costCenterId: string | null;
  sortOrder: number;
}

export interface DayVoucherInput {
  lines: readonly DayVoucherInputLine[];
  /** The report's stored total, öre; must equal the lines' sum. */
  total: number;
  /** Where the money landed: the Zettle or Swish clearing account. */
  clearingAccount: string;
  accountName: (account: string) => string;
}

/**
 * Why these takings cannot be booked, or null when they can. Each is a message
 * key under `errors.income`.
 *
 * `noCostCenter` is the one the per-line cost centre exists for: a row that
 * reaches Fortnox without one is takings no verksamhet's result will ever show,
 * so a line nobody gave a cost centre stops the day rather than being booked
 * blank. `unbalanced` means the stored total has drifted from the lines, which
 * would be a bug, but a voucher Fortnox rejects at export is a worse place to
 * find it.
 */
export type IncomeVoucherBlocker =
  | "noDistributions"
  | "noClearingAccount"
  | "noAccount"
  | "noCostCenter"
  | "unbalanced";

export function incomeVoucherBlocker(input: DayVoucherInput): IncomeVoucherBlocker | null {
  const usable = input.lines.filter((l) => l.total !== 0);
  if (usable.length === 0) return "noDistributions";
  if (!input.clearingAccount.trim()) return "noClearingAccount";
  // A fee line with no fee account chosen, or a line someone cleared.
  if (usable.some((l) => !l.account.trim())) return "noAccount";
  if (usable.some((l) => !l.costCenterId)) return "noCostCenter";
  const sum = input.lines.reduce((s, l) => s + l.total, 0);
  if (sum !== input.total) return "unbalanced";
  return null;
}

/**
 * The voucher rows for a day: one per (account, cost centre), then the
 * clearing account.
 *
 * A positive sum is money in, credited; a negative one (a fee, or a net refund
 * against an account) is debited, booked as the row the other way round rather
 * than as a negative amount, which is what a ledger can actually represent.
 * Pairs that come to nothing are dropped: a product sold and refunded the same
 * day is noise in the ledger, and Fortnox rejects some zero rows outright.
 *
 * The clearing row takes what is left, which is what the day pays out. It has
 * no cost centre, deliberately: a clearing account is a bank balance, not a
 * dimension of anybody's budget. A day that nets to exactly nothing has no
 * clearing row at all, since its other rows already balance.
 */
export function buildDayVoucherLines(input: DayVoucherInput): IncomeVoucherLine[] {
  const byRow = new Map<string, { account: string; costCenterId: string | null; total: number }>();
  for (const line of input.lines) {
    const key = `${line.account}|${line.costCenterId ?? ""}`;
    const row = byRow.get(key);
    if (row) row.total += line.total;
    else byRow.set(key, { account: line.account, costCenterId: line.costCenterId, total: line.total });
  }

  // Stable order, so two vouchers for the same shape of day read the same:
  // revenue before costs, then by account, then by cost centre.
  const rows = [...byRow.values()]
    .filter((r) => r.total !== 0)
    .toSorted(
      (a, b) =>
        Number(b.total > 0) - Number(a.total > 0) ||
        a.account.localeCompare(b.account) ||
        (a.costCenterId ?? "").localeCompare(b.costCenterId ?? ""),
    )
    .map((r, i) => ({
      account: r.account,
      accountName: input.accountName(r.account),
      debit: r.total < 0 ? -r.total : 0,
      credit: r.total > 0 ? r.total : 0,
      costCenterId: r.costCenterId,
      sortOrder: i,
    }));

  const net = rows.reduce((sum, r) => sum + r.credit - r.debit, 0);
  if (net === 0) return rows;

  return [
    ...rows,
    {
      account: input.clearingAccount,
      accountName: input.accountName(input.clearingAccount),
      debit: net > 0 ? net : 0,
      credit: net < 0 ? -net : 0,
      costCenterId: null,
      sortOrder: rows.length,
    },
  ];
}
