// A sum somebody typed into a field that wants a number.
//
// Shared by the stock counts (ten crates of twenty-four, plus thirty loose)
// and the voucher's debit and credit cells (a receipt's two lines, or 25 % of
// one). Working it out in your head and typing the answer is how the wrong
// figure ends up on the page, so the field takes the sum and adds it up.
//
// Parsed rather than evaluated. `eval` and `new Function` would do this in a
// line and would also run whatever else was typed into a field that is
// sometimes filled in from a barcode scanner. There is no version of that worth
// the line it saves. What is here understands four operators, brackets and
// nothing whatsoever else.

/**
 * Add up a typed sum.
 *
 * A recursive descent over `+ - * / ( )` and numbers, which is the whole
 * grammar. Anything it cannot read (a stray bracket, an operator with nothing
 * after it, a decimal point on its own) comes back as null rather than as a
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
