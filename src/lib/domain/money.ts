// Money is stored as integer öre (1 SEK = 100 öre) to avoid float drift; the UI works in SEK.
// These are the single pair of converters. Do not hand-roll `* 100` / `/ 100` elsewhere.
import { evaluate } from "@/lib/domain/arithmetic";

/** öre (integer) → SEK (decimal), for display/serialisation. */
export function oreToSEK(ore: number | null | undefined): number {
  return (ore ?? 0) / 100;
}

/** SEK (decimal, possibly from user input) → öre (integer), rounded. */
export function sekToOre(sek: number | null | undefined): number {
  return Math.round((sek ?? 0) * 100);
}

/** What may stand in an amount field while typed: digits, spaces as thousand separators (any space, incl. non-breaking, as `groupForm` writes), one comma or dot, at most two decimals. A magnitude only: the sign is a separate control (no minus key on phone keyboards). Partial input ("12,") must pass. */
const AMOUNT_INPUT = /^[\d\s]*(?:[.,]\d{0,2})?$/;

/** Whole digits in threes with a plain space, "1234567" → "1 234 567". The grouping every number field writes. */
export const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/**
 * An amount in kronor as every amount field holds one: grouped, a comma, always two decimals,
 * "1 250,00". Empty for no amount. The one form a field shows, idle or focused, so it never
 * changes under the caret: what is left after typing 1000 is what is there on coming back.
 * A plain space groups, not Intl's non-breaking one, so a copied figure pastes anywhere.
 */
export function sekToInput(sek: number | null): string {
  if (sek == null) return "";
  const ore = sekToOre(sek);
  const abs = Math.abs(ore);
  const kronor = groupDigits(String(Math.floor(abs / 100)));
  return `${ore < 0 ? "-" : ""}${kronor},${String(abs % 100).padStart(2, "0")}`;
}

/** An amount field as it is left: "700" → "700,00", "1234.5" → "1 234,50". Blank stays blank. */
export const fullAmountForm = (input: string): string =>
  /\d/.test(input) ? sekToInput(parseSEK(input)) : input;

export function isAmountInput(input: string): boolean {
  return AMOUNT_INPUT.test(input);
}

/** What may stand in a voucher cell while typed: an amount or a sum (`1250*0,25+40`, a leading "=" is taken too). Worked out when the cell is left (`settleAmount`). */
const SUM_INPUT = /^\s*=?[\d\s.,+\-*/()]*$/;

export const isSumInput = (input: string): boolean => SUM_INPUT.test(input);

/** Whether a cell holds a sum still to be worked out, not a plain amount. */
export const isSum = (input: string): boolean => /^=|[+\-*/()]/.test(input.trim());

const sumOf = (input: string): number | null => evaluate(input.trim().replace(/^=/, ""));

/** A cell as it is left, written like an amount field ("1 312,50"): a plain amount in full, a sum as its answer. Null for a sum that does not add up or is negative. */
export function settleAmount(input: string): string | null {
  if (!isSum(input)) return fullAmountForm(input);
  const sek = sumOf(input);
  if (sek === null || sek < 0) return null;
  return sekToInput(sek);
}

/** Parse a user-entered amount string ("1 234,50" / "1234.5") into SEK. Reads a sign, since stored returns are signed. */
export function parseSEK(input: string): number {
  // A voucher cell can hold a sum while typed: read as its answer so the totals follow along.
  if (isSum(input)) return sumOf(input) ?? 0;
  const normalised = input.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a user-entered amount string straight into öre (integer). */
export function parseOre(input: string): number {
  return sekToOre(parseSEK(input));
}
