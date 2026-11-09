// A sum somebody typed into a field that wants a number (stock counts, voucher debit/credit cells).
// Parsed, never `eval`ed: the field is sometimes filled from a barcode scanner. Understands four
// operators and brackets only.

/** Add up a typed sum with a recursive descent over `+ - * / ( )` and numbers. Anything unreadable gives null, not a half-parse. */
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
    // Unary signs, so `-4` and `+4` read as themselves.
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
      // Division by nothing is not a quantity, and NaN would pass every comparison below as false.
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
