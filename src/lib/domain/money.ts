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

/** The same amount, written the Swedish way. A phone's decimal pad may offer a full stop, so it is accepted on input and shown back as a comma. */
export const commaForm = (input: string): string => input.replace(/\./g, ",");

/** An amount in kronor as an amount field writes one, "1250,00". Empty for no amount. */
export const sekToInput = (sek: number | null): string =>
  sek == null ? "" : commaForm(oreToSEK(sekToOre(sek)).toFixed(2));

export function isAmountInput(input: string): boolean {
  return AMOUNT_INPUT.test(input);
}

/** What may stand in a voucher cell while typed: an amount or a sum (`1250*0,25+40`, a leading "=" is taken too). Worked out when the cell is left (`settleAmount`). */
const SUM_INPUT = /^\s*=?[\d\s.,+\-*/()]*$/;

export const isSumInput = (input: string): boolean => SUM_INPUT.test(input);

/** Whether a cell holds a sum still to be worked out, not a plain amount. */
export const isSum = (input: string): boolean => /^=|[+\-*/()]/.test(input.trim());

const sumOf = (input: string): number | null => evaluate(input.trim().replace(/^=/, ""));

/** A cell as it is left: a sum becomes its answer in öre, written like an amount field ("312,50"). Null for a sum that does not add up or is negative. */
export function settleAmount(input: string): string | null {
  if (!isSum(input)) return input;
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

/** The same figure grouped the Swedish way: "1234.5" → "1 234,50". Display only: the field keeps what was typed. */
export function groupForm(input: string): string {
  if (!/\d/.test(input)) return input;
  const n = parseSEK(input);
  return new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Parse a user-entered amount string straight into öre (integer). */
export function parseOre(input: string): number {
  return sekToOre(parseSEK(input));
}
