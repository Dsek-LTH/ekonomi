// A count somebody typed, which is not always a number.
//
// Registering a delivery is arithmetic done standing up: ten crates of
// twenty-four, plus the thirty loose ones on the pallet. Making somebody work
// that out in their head and type 270 is how 260 ends up in the log, so the
// field takes the sum itself — `24*10+30` — and adds it up.
//
// Parsed rather than evaluated. `eval` and `new Function` would do this in a
// line and would also run whatever else was typed into a field that is
// sometimes filled in from a barcode scanner; there is no version of that worth
// the line it saves. What is here understands four operators, brackets and
// nothing whatsoever else.

/** What a typed count came to, or why it did not come to anything. */
export interface Quantity {
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
 * it, which is what you want to see — and also hides the fact that there is
 * working behind it, so the cell says so with a tint instead.
 */
export const isExpression = (text: string): boolean => /[+\-*/()]/.test(text.trim());

/**
 * Add up a typed sum.
 *
 * A recursive descent over `+ - * / ( )` and numbers, which is the whole
 * grammar. Anything it cannot read — a stray bracket, an operator with nothing
 * after it, a decimal point on its own — comes back as null rather than as a
 * number that happens to fall out of a half-parse.
 */
export function evaluate(text: string): number | null {
  const src = text.replace(/\s+/g, "").replace(/,/g, ".");
  if (src === "") return null;

  let at = 0;
  const peek = () => src[at];

  function number(): number | null {
    const start = at;
    while (at < src.length && /[0-9.]/.test(src[at])) at++;
    if (at === start) return null;
    const n = Number(src.slice(start, at));
    return Number.isFinite(n) ? n : null;
  }

  function factor(): number | null {
    // Unary signs, so `-4` and `+4` read as themselves rather than as an
    // operator with nothing on its left.
    if (peek() === "-") {
      at++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === "+") {
      at++;
      return factor();
    }
    if (peek() === "(") {
      at++;
      const v = expression();
      if (v === null || peek() !== ")") return null;
      at++;
      return v;
    }
    return number();
  }

  function term(): number | null {
    let left = factor();
    if (left === null) return null;
    while (peek() === "*" || peek() === "/") {
      const op = src[at++];
      const right = factor();
      if (right === null) return null;
      // Division by nothing is not a quantity, and NaN would sail through every
      // comparison below as false.
      if (op === "/" && right === 0) return null;
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }

  function expression(): number | null {
    let left = term();
    if (left === null) return null;
    while (peek() === "+" || peek() === "-") {
      const op = src[at++];
      const right = term();
      if (right === null) return null;
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }

  const value = expression();
  // Trailing rubbish means it was only partly read: `4)` is not four.
  if (value === null || at !== src.length || !Number.isFinite(value)) return null;
  return value;
}

/**
 * What a typed count means, given how many there are to take.
 *
 * Rounded to a whole thing — half a can is not a quantity — and held between
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
