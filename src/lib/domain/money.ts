// Money is stored everywhere in the DB as an integer number of öre (1 SEK = 100
// öre) to avoid floating-point drift. The UI works in SEK. These are the single
// pair of converters. Do not hand-roll `* 100` / `/ 100` elsewhere.

/** öre (integer) → SEK (decimal), for display/serialisation. */
export function oreToSEK(ore: number | null | undefined): number {
  return (ore ?? 0) / 100;
}

/** SEK (decimal, possibly from user input) → öre (integer), rounded. */
export function sekToOre(sek: number | null | undefined): number {
  return Math.round((sek ?? 0) * 100);
}

/**
 * What may stand in an amount field while it is being typed: digits, spaces as
 * thousand separators, one comma or dot, at most two decimals.
 *
 * Two decimals because öre is the resolution money is stored at (see above). A
 * third is not a smaller amount, it is one that `sekToOre` rounds away, and a
 * figure that changes between typing it and saving it is the kind of thing
 * nobody notices until the voucher is off by an öre.
 *
 * A magnitude, and only a magnitude. Nothing is typed negative in this app:
 * which way the money goes is a question the form asks with a control of its
 * own (Utlägg / Retur), because no phone keyboard has a minus key, at any
 * `inputmode` and behind no pattern, and a figure somebody cannot type on the
 * machine they are holding is not a figure a form may ask for. There is no
 * operator to type either, for the same reason: a receipt of several lines is
 * several rows, one figure each.
 *
 * Partial input has to pass, since this is tested on every keystroke: "12," and
 * "" are both on the way to a number.
 *
 * Any space, not only the one on the keyboard: Swedish groups thousands with a
 * non-breaking space and that is what `groupForm` puts on the screen, so it is
 * what comes back when somebody copies a figure out of one field and into
 * another.
 */
const AMOUNT_INPUT = /^[\d\s]*(?:[.,]\d{0,2})?$/;

/**
 * The same amount, written the way a Swedish reader writes one.
 *
 * Both separators are accepted on the way in and always were. `parseSEK` reads
 * either. This is about what the field shows afterwards, and it exists because
 * of the keyboard: a phone's decimal pad offers the separator its *device*
 * locale uses, so a Swedish member with an English phone can only type a full
 * stop into a field labelled Belopp. Taking it and showing back a comma means
 * the keypad they happen to have stops being their problem.
 */
export const commaForm = (input: string): string => input.replace(/\./g, ",");

/** Whether `input` is on its way to being an amount. See AMOUNT_INPUT. */
export function isAmountInput(input: string): boolean {
  return AMOUNT_INPUT.test(input);
}

/**
 * Parse a user-entered amount string ("1 234,50" / "1234.5") into SEK.
 *
 * Reads a sign even though no field lets one be typed: what comes back from the
 * database is a signed figure, and a screen filling a field from a stored
 * return has to read it before it can show its magnitude.
 */
export function parseSEK(input: string): number {
  const normalised = input.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The same figure grouped the way a Swedish reader writes one: "1234.5" →
 * "1 234,50".
 *
 * What an amount field shows while nobody is in it. What it *holds* stays what
 * was typed, because a thousands space is pleasant to read and miserable to
 * backspace through, and the field is handed back exactly as it was left.
 */
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
