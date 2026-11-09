// A typed count that may be a sum (`24*10+30`), added up by lib/domain/arithmetic.

import { evaluate } from "@/lib/domain/arithmetic";

/** What a typed count came to, or why it did not. */
interface Quantity {
  /** A whole number, never negative, never above the cap. */
  value: number;
  /** Whether the text is a valid sum. Empty text is not. */
  ok: boolean;
  /** Whether it was brought down to the cap. */
  capped: boolean;
}

/** Characters a sum may contain, refused as typed. */
const ALLOWED = /^[0-9+\-*/().,\s]*$/;

export const isQuantityInput = (text: string): boolean => ALLOWED.test(text);

/** Whether this is a sum rather than a plain figure. Display only (the cell is tinted). */
export const isExpression = (text: string): boolean => /[+\-*/()]/.test(text.trim());

/** Rounded to a whole thing and held between zero and `max`. `capped` says the ceiling applied. */
export function quantity(text: string, max = Number.MAX_SAFE_INTEGER): Quantity {
  const raw = evaluate(text);
  if (raw === null) return { value: 0, ok: false, capped: false };
  const whole = Math.round(raw);
  const held = Math.min(Math.max(0, whole), Math.max(0, max));
  return { value: held, ok: true, capped: whole > max };
}
