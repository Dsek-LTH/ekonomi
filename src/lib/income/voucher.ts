// Builds the rows of a day's income verifikation. One voucher per day and source; each row is an
// (account, cost centre) pair. Zettle fees are lines of the same day. Amounts are öre, so
// "debit equals credit" is an integer comparison (see `voucherBlocker` in lib/domain/voucher.ts).
import type { VoucherLine } from "@/lib/domain/voucher";
import type { IncomeSource } from "@/lib/domain/types";

/**
 * The verifikation text: the payment method only. With the date it is how a day is recognised in
 * Fortnox (lib/income/duplicate.ts). Older vouchers ("Swish - Café", "Zettleavgifter") still exist
 * there, so the duplicate check matches on the leading method (`incomeVoucherCoversDay`).
 */
export function incomeVoucherDescription(source: IncomeSource): string {
  return source === "SWISH" ? "Swish" : "Zettle";
}

/**
 * The Fortnox verifikationsserie for a day's takings, falling back to the connection's series.
 * Must be the one source for both the duplicate check and the export, or days get written twice.
 */
export function incomeVoucherSeries(
  settings: { incomeVoucherSeries: string | null } | null,
  connectionSeries: string | null,
): string | null {
  return settings?.incomeVoucherSeries?.trim() || connectionSeries;
}

/**
 * The key a unit's reports are grouped under, derived from its name once and never changed.
 * Diacritics are folded and the rest dropped, since another service uses it as a map key and
 * in filenames: "Sexmästeriet" -> "sexmasteriet".
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
 * The fingerprint a day's takings have in Fortnox: date plus description, case- and
 * space-insensitive. A leading "IR" is folded away because descriptions were once written
 * "IR Swish - Café" and both wordings exist in Fortnox and locally.
 */
export function incomeVoucherKey(date: string, description: string): string {
  const text = description
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    // Anchored and only when something follows: a name starting with "ir" is not a prefix.
    .replace(/^ir[\s-]+/, "");
  return `${date}|${text}`;
}

/**
 * Whether a voucher already in Fortnox books the same source's takings on its date. Matches by
 * the leading method, not equality, since older wordings ("Zettle - Café", "Zettleavgifter",
 * "IR " prefix) mean part of the day is already booked.
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
  /** Null on the clearing row. */
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
 * Why these takings cannot be booked, or null. Each is a message key under `errors.income`.
 * `noCostCenter`: a row without one never shows in any verksamhet's result.
 */
export type IncomeVoucherBlocker =
  "noDistributions" | "noClearingAccount" | "noAccount" | "noCostCenter" | "unbalanced";

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
 * The voucher rows for a day: one per (account, cost centre), then the clearing account.
 * A negative sum (a fee, a net refund) is booked as the opposite side. Zero pairs are dropped
 * (Fortnox rejects some). The clearing row takes what is left and has no cost centre; a day
 * that nets to nothing has none.
 */
export function buildDayVoucherLines(input: DayVoucherInput): IncomeVoucherLine[] {
  const byRow = new Map<string, { account: string; costCenterId: string | null; total: number }>();
  for (const line of input.lines) {
    const key = `${line.account}|${line.costCenterId ?? ""}`;
    const row = byRow.get(key);
    if (row) row.total += line.total;
    else
      byRow.set(key, { account: line.account, costCenterId: line.costCenterId, total: line.total });
  }

  // Stable order: revenue before costs, then account, then cost centre.
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
