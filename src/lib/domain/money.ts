// Money is stored everywhere in the DB as an integer number of öre (1 SEK = 100
// öre) to avoid floating-point drift. The UI works in SEK. These are the single
// pair of converters — do not hand-roll `* 100` / `/ 100` elsewhere.

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
 * thousand separators, one comma or dot, at most two decimals, optional minus.
 *
 * Two decimals because öre is the resolution money is stored at (see above) — a
 * third is not a smaller amount, it is one that `sekToOre` rounds away, and a
 * figure that changes between typing it and saving it is the kind of thing
 * nobody notices until the voucher is off by an öre.
 *
 * Partial input has to pass, since this is tested on every keystroke: "-", "12,"
 * and "" are all on the way to a number.
 */
const AMOUNT_INPUT = /^-?[\d ]*(?:[.,]\d{0,2})?$/;

/**
 * The same amount, written the way a Swedish reader writes one.
 *
 * Both separators are accepted on the way in and always were — `parseSEK` reads
 * either. This is about what the field shows afterwards, and it exists because
 * of the keyboard: a phone's decimal pad offers the separator its *device*
 * locale uses, so a Swedish member with an English phone can only type a full
 * stop into a field labelled Belopp. Taking it and showing back a comma means
 * the keypad they happen to have stops being their problem.
 */
export const commaForm = (input: string): string => input.replace(".", ",");

/**
 * The same amount with its sign turned over — "12,50" ⇄ "-12,50".
 *
 * A negative amount is a real and ordinary thing here: a return is the same
 * utlägg with the sign flipped. But no mobile numeric keypad has a minus key —
 * not iOS's, not Android's, at any `inputMode` — so on a phone the sign is not
 * something that can be typed at all, and a control has to offer it instead.
 *
 * An empty field flips to "-", which is what somebody reaching for the sign
 * before the digits means, and what `isAmountInput` already allows as partial
 * input.
 */
export const flipSign = (input: string): string =>
  input.startsWith("-") ? input.slice(1) : `-${input}`;

/** Whether `input` is on its way to being an amount — see AMOUNT_INPUT. */
export function isAmountInput(input: string): boolean {
  return AMOUNT_INPUT.test(input);
}

/** Parse a user-entered amount string ("1 234,50" / "1234.5") into SEK. */
export function parseSEK(input: string): number {
  const normalised = input.replace(/\s/g, "").replace(",", ".");
  const n = Number(normalised);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a user-entered amount string straight into öre (integer). */
export function parseOre(input: string): number {
  return sekToOre(parseSEK(input));
}
