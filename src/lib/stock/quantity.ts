// A count somebody typed, which is not always a number.
//
// Registering a delivery is arithmetic done standing up: ten crates of
// twenty-four, plus the thirty loose ones on the pallet. Making somebody work
// that out in their head and type 270 is how 260 ends up in the log, so the
// field takes the sum itself (`24*10+30`) and adds it up.
//
// The sum itself is added up by lib/domain/arithmetic, which the voucher's
// amount cells share.
import { evaluate } from "@/lib/domain/arithmetic";

/** What a typed count came to, or why it did not come to anything. */
interface Quantity {
  /** The value to use: a whole number, never negative, never above the cap. */
  value: number;
  /** Whether the text is a sum that adds up at all. Empty text is not. */
  ok: boolean;
  /** Whether it added up to more than there is, and was brought down to it. */
  capped: boolean;
}

/** The characters a sum may be made of. Everything else is refused as it is
 *  typed, so a field never holds something that cannot be read. */
const ALLOWED = /^[0-9+\-*/().,\s]*$/;

export const isQuantityInput = (text: string): boolean => ALLOWED.test(text);

/**
 * Whether this is a sum rather than a figure typed straight in.
 *
 * Only for showing. A cell holding `24*10+30` reads as `270` when nobody is in
 * it, which is what you want to see, and also hides the fact that there is
 * working behind it, so the cell says so with a tint instead.
 */
export const isExpression = (text: string): boolean => /[+\-*/()]/.test(text.trim());

/**
 * What a typed count means, given how many there are to take.
 *
 * Rounded to a whole thing (half a can is not a quantity) and held between
 * nothing and `max`. Both bounds are facts rather than opinions: you cannot
 * take a negative number of bottles off a shelf, and you cannot take more than
 * are on it. `capped` says the ceiling did something, so a screen can mention
 * it rather than quietly changing what somebody typed.
 */
export function quantity(text: string, max = Number.MAX_SAFE_INTEGER): Quantity {
  const raw = evaluate(text);
  if (raw === null) return { value: 0, ok: false, capped: false };
  const whole = Math.round(raw);
  const held = Math.min(Math.max(0, whole), Math.max(0, max));
  return { value: held, ok: true, capped: whole > max };
}
