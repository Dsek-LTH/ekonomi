// Barcodes: whether one is real, and the section's own for a product that has
// none.
//
// Every EAN and GTIN ends in a check digit worked out from the others, which is
// what lets a till catch a misread. It catches a made-up number just as well:
// nine in ten of them do not add up. A barcode typed in is held to it, so a
// product cannot be filed under "12345678" to get past the field, which is
// what happened to a keg that had no barcode at all.
//
// For that keg there is an honest way instead: the product is marked as having
// none, and is given a code of the section's own. GS1 sets aside the codes that
// begin with 2 for exactly this, a shop's own goods, so one can never be the
// barcode of a real product. They begin "20" here and count up.

/** Digits in the lengths GS1 issues: EAN-8, UPC-A, EAN-13, GTIN-14. */
const LENGTHS = new Set([8, 12, 13, 14]);

/** Whether the last digit is the check digit the others call for. */
export function validGtin(code: string): boolean {
  const c = code.trim();
  if (!/^\d+$/.test(c) || !LENGTHS.has(c.length)) return false;
  const digits = [...c].map(Number);
  const check = digits.pop()!;
  // Weighted 3, 1, 3, 1… from the digit nearest the check digit.
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** The prefix the section's own codes are made under. */
export const INTERNAL_PREFIX = "20";

/** One of the section's own codes rather than a manufacturer's. */
export function isInternalCode(code: string | null | undefined): boolean {
  return Boolean(code) && /^2\d{12}$/.test(code!.trim());
}

/**
 * The section's own code number `n`: "20", the number to ten digits, and the
 * check digit, so it is a valid EAN-13 a scanner reads like any other.
 */
export function internalCode(n: number): string {
  const body = INTERNAL_PREFIX + String(n).padStart(10, "0");
  for (let check = 0; check <= 9; check++) {
    if (validGtin(body + check)) return body + check;
  }
  throw new Error("unreachable: one of ten digits is always the check digit");
}

/** The number an internal code was made from, or null for any other code. */
export function internalNumber(code: string): number | null {
  if (!code.startsWith(INTERNAL_PREFIX) || !isInternalCode(code)) return null;
  return Number(code.slice(INTERNAL_PREFIX.length, -1));
}
