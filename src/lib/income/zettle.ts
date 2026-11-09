// What Zettle's API returns, made into sold lines and fees. Pure (lib/income/zettle-client.ts fetches).
//  - A timestamp's day is the Swedish day it falls on. One with no offset is read as UTC.
//  - A line total is quantity * unit price - its own discount. A purchase-level discount is spread
//    over the positive lines by largest remainder, so shares add up to the öre.
//  - Fees are the PAYMENT_FEE transactions only, stored as positive costs.

import type { ZettleFee, ZettleSaleLine } from "./types";

// ── The API's shapes, as far as this reads them ─────────────────────

export interface ZettlePurchaseDiscount {
  percentage?: number | null;
  amount?: number | null;
  value?: number;
}

// Every field optional, because Zettle leaves fields out.
export interface ZettleProduct {
  name?: string;
  variantName?: string;
  /** A string in the API: "2". */
  quantity?: string;
  /** öre */
  unitPrice?: number;
  /** öre, this line's own discount */
  discountValue?: number;
}

export interface ZettlePurchase {
  purchaseUUID?: string;
  timestamp?: string;
  products?: ZettleProduct[];
  discounts?: ZettlePurchaseDiscount[];
}

export interface ZettleTransaction {
  timestamp?: string;
  /** öre, a fee is negative */
  amount: number;
  originatorTransactionType?: string;
}

export const TX_PAYMENT = "PAYMENT";
export const TX_PAYMENT_FEE = "PAYMENT_FEE";
export const TX_PAYOUT = "PAYOUT";

// ── Days ────────────────────────────────────────────────────────────

const stockholmDay = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const stockholmOffset = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Stockholm",
  timeZoneName: "longOffset",
});

const TIMESTAMP =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** A timestamp as epoch milliseconds, or null when it is none of Zettle's shapes. */
function instant(ts: string): number | null {
  const m = TIMESTAMP.exec(ts.trim());
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0", zone] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, Number(`0.${frac}`) * 1000);
  if (zone && zone !== "Z") {
    const sign = zone[0] === "-" ? -1 : 1;
    const digits = zone.slice(1).replace(":", "");
    ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
  }
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The Swedish day a Zettle timestamp falls on, "2026-01-02". An unreadable
 * timestamp comes back unchanged, so it stands out as a nonsense date rather
 * than quietly becoming a wrong one.
 */
export function zettleDay(ts: string): string {
  const ms = instant(ts);
  return ms === null ? ts : stockholmDay.format(new Date(ms));
}

/** "+01:00" or "+02:00": Stockholm's offset from UTC at an instant. */
function offsetAt(ms: number): string {
  const name = stockholmOffset.formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName");
  const m = /GMT([+-]\d{2}):?(\d{2})?/.exec(name?.value ?? "");
  return m ? `${m[1]}:${m[2] ?? "00"}` : "+00:00";
}

/** Midnight in Lund at the start of an ISO day, as Zettle's range parameters take it. */
export function stockholmMidnight(day: string): string {
  // Clocks change at 01:00 UTC, so guess, then confirm.
  const utc = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
  const guess = offsetAt(utc);
  const hours = (o: string) =>
    (o[0] === "-" ? -1 : 1) * (Number(o.slice(1, 3)) + Number(o.slice(4)) / 60);
  return `${day}T00:00:00${offsetAt(utc - hours(guess) * 3_600_000)}`;
}

/** The day after an ISO day. */
function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The query range for days `from` to `to` inclusive: Swedish midnight to Swedish midnight after `to` (Zettle's end is exclusive). */
export function zettleRange(from: string, to: string): { start: string; end: string } {
  return { start: stockholmMidnight(from), end: stockholmMidnight(nextDay(to)) };
}

// ── Purchases ───────────────────────────────────────────────────────

/** "2" -> 2. Anything else is 0. */
function quantityOf(q: string): number {
  const t = q.trim();
  return /^[+-]?\d+$/.test(t) ? Number(t) : 0;
}

/** A purchase-level discount in öre: its value, else its amount, else its percentage of the positive total. */
export function purchaseDiscountValue(d: ZettlePurchaseDiscount, positiveTotal: number): number {
  if (d.value) return d.value;
  if (d.amount != null) return d.amount;
  if (d.percentage != null)
    return Math.floor((Math.trunc(positiveTotal * d.percentage) + 50) / 100);
  return 0;
}

/** `amount` split over the lines in proportion to their totals: floors, then the rest to the largest remainders. Non-positive lines get nothing. */
export function allocateByLargestRemainder(
  amount: number,
  totals: readonly number[],
  positiveTotal: number,
): number[] {
  const allocations = totals.map(() => 0);
  const remainders: { index: number; remainder: number }[] = [];
  let allocated = 0;
  totals.forEach((total, index) => {
    if (total <= 0) return;
    const numerator = amount * total;
    const base = Math.trunc(numerator / positiveTotal);
    allocations[index] = base;
    allocated += base;
    remainders.push({ index, remainder: numerator % positiveTotal });
  });
  // Stable, so equal remainders keep line order.
  remainders.sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; i < amount - allocated; i++) {
    allocations[remainders[i % remainders.length].index]++;
  }
  return allocations;
}

/** Every line of every purchase, purchase-level discounts spread over them. */
export function normalizePurchases(purchases: readonly ZettlePurchase[]): ZettleSaleLine[] {
  const lines: ZettleSaleLine[] = [];
  for (const purchase of purchases) {
    const date = zettleDay(purchase.timestamp ?? "");
    const own: ZettleSaleLine[] = (purchase.products ?? []).map((p) => {
      // Missing fields are zero values; a custom-amount sale can come without a name (empty, not missing).
      const quantity = quantityOf(p.quantity ?? "");
      const unitPrice = p.unitPrice ?? 0;
      const discount = p.discountValue ?? 0;
      return {
        purchaseId: purchase.purchaseUUID ?? "",
        date,
        name: p.name ?? "",
        ...(p.variantName ? { variant: p.variantName } : {}),
        quantity,
        unitPrice,
        discount,
        total: quantity * unitPrice - discount,
      };
    });

    const discounts = purchase.discounts ?? [];
    const totals = own.map((l) => l.total);
    const positiveTotal = totals.reduce((s, t) => s + (t > 0 ? t : 0), 0);
    if (own.length > 0 && discounts.length > 0 && positiveTotal > 0) {
      for (const d of discounts) {
        const amount = purchaseDiscountValue(d, positiveTotal);
        if (amount === 0) continue;
        allocateByLargestRemainder(amount, totals, positiveTotal).forEach((share, i) => {
          own[i].discount += share;
          own[i].total -= share;
        });
      }
    }
    lines.push(...own);
  }
  return lines;
}

/** The fee transactions, as positive costs by Swedish day. */
export function normalizeFees(transactions: readonly ZettleTransaction[]): ZettleFee[] {
  return transactions
    .filter((t) => t.originatorTransactionType === TX_PAYMENT_FEE && (t.amount ?? 0) !== 0)
    .map((t) => ({ date: zettleDay(t.timestamp ?? ""), amount: -t.amount }));
}
