// Routing: which verksamhet a sale is, which account it is credited to and which cost centre it
// books against. The one place this is decided. Pure: a table in (built by lib/income/config.ts),
// sales in, reports out. Prefixes match in any case and longer prefixes are tried first.

import type { IncomeDayDto, IncomeDayLine, SwishPayment, ZettleFee, ZettleSaleLine } from "./types";

/** Where a sale is booked: a verksamhet by income key, an account and a cost centre (resolved in lib/income/config.ts). */
export interface Route {
  key: string;
  account: string;
  costCenterId: string | null;
}

/** Where Zettle's fees book. Not a route. */
export interface FeeRoute {
  account: string;
  costCenterId: string | null;
}

export interface RoutingTable {
  /** Product-name prefix, lower-case, to where it routes. */
  prefixes: ReadonlyMap<string, Route>;
  /** Where a sale matching no prefix goes. See BookkeepingSettings. */
  fallback: Route;
  /** Swish amount in öre to a message to route as, for an unlabelled payment. */
  swishAmountGuesses: ReadonlyMap<number, string>;
}

// Between prefix and product: hyphens, en or em dashes and spaces.
const SEPARATOR = "[-\u2013\u2014 ]+";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern that splits a name into its prefix and the rest. */
function prefixPattern(table: RoutingTable): RegExp | null {
  if (table.prefixes.size === 0) return null;
  const codes = [...table.prefixes.keys()].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  return new RegExp(`^(${codes.map(escape).join("|")})${SEPARATOR}(.+?)$`, "i");
}

/** Where `text` routes by its prefix, and the name without it, or null. */
function byPrefix(table: RoutingTable, pattern: RegExp | null, text: string) {
  const m = pattern?.exec((text ?? "").trim());
  if (!m) return null;
  const route = table.prefixes.get(m[1].toLowerCase());
  return route ? { route, name: m[2].trim() } : null;
}

/** A custom till amount has no name, and a blank review row would look like a rendering fault. */
export const UNNAMED_PRODUCT = "Vara utan namn";

/** A Zettle product: by its prefix, or to the reserv under its full name. */
function routeProduct(table: RoutingTable, pattern: RegExp | null, name: string) {
  const placed = byPrefix(table, pattern, name);
  return placed
    ? { ...placed, unmatched: false }
    : { route: table.fallback, name: (name ?? "").trim() || UNNAMED_PRODUCT, unmatched: true };
}

/**
 * A Swish payment: by its message's prefix, then by the guess kept for its
 * exact amount, and only then to the reserv, under the message as written.
 */
function routePayment(table: RoutingTable, pattern: RegExp | null, p: SwishPayment) {
  const direct = byPrefix(table, pattern, p.message);
  if (direct) return { ...direct, unmatched: false };
  const guess = table.swishAmountGuesses.get(p.amount);
  const guessed = guess ? byPrefix(table, pattern, guess) : null;
  return guessed
    ? { ...guessed, unmatched: false }
    : { route: table.fallback, name: (p.message ?? "").trim(), unmatched: true };
}

/** Days being built, by date. */
class Days {
  private byDate = new Map<string, IncomeDayDto>();

  add(date: string, line: IncomeDayLine) {
    let day = this.byDate.get(date);
    if (!day) {
      day = { date, lines: [], total: 0 };
      this.byDate.set(date, day);
    }

    // Same product, price, verksamhet, account and cost centre is one line with summed quantity.
    const same = day.lines.find(
      (l) =>
        l.kind === line.kind &&
        l.unitKey === line.unitKey &&
        l.name === line.name &&
        (l.variant ?? "") === (line.variant ?? "") &&
        l.account === line.account &&
        l.costCenterId === line.costCenterId &&
        l.unitPrice === line.unitPrice &&
        l.unmatched === line.unmatched,
    );
    if (same) {
      same.quantity += line.quantity;
      same.effectiveDiscount += line.effectiveDiscount;
      same.total += line.total;
    } else {
      day.lines.push({ ...line });
    }
    day.total += line.total;
  }

  /** Oldest first, so the same fetch always comes back in the same order. */
  list(): IncomeDayDto[] {
    return [...this.byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

const saleLine = (
  route: Route,
  name: string,
  unmatched: boolean,
  rest: Pick<IncomeDayLine, "variant" | "quantity" | "unitPrice" | "effectiveDiscount" | "total">,
): IncomeDayLine => ({
  kind: "SALE",
  unitKey: route.key,
  name,
  ...(rest.variant ? { variant: rest.variant } : {}),
  account: route.account,
  costCenterId: route.costCenterId,
  quantity: rest.quantity,
  unitPrice: rest.unitPrice,
  effectiveDiscount: rest.effectiveDiscount,
  total: rest.total,
  unmatched,
});

/**
 * A Zettle range as one report per day: every verksamhet's sales plus the day's fees. Fees are
 * lines of the same day (they leave the clearing account), equal fees are one line with a count,
 * and a fee line is negative unless Zettle paid it back.
 */
export function routeZettleSales(
  table: RoutingTable,
  sales: readonly ZettleSaleLine[],
  fees: readonly ZettleFee[],
  fee: FeeRoute,
): IncomeDayDto[] {
  const pattern = prefixPattern(table);
  const days = new Days();
  for (const line of sales) {
    const { route, name, unmatched } = routeProduct(table, pattern, line.name);
    days.add(
      line.date,
      saleLine(route, name, unmatched, {
        variant: line.variant,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        effectiveDiscount: line.discount,
        total: line.total,
      }),
    );
  }
  for (const f of fees) {
    if (f.amount === 0) continue;
    days.add(f.date, {
      kind: "FEE",
      unitKey: null,
      name: "Zettleavgift",
      account: fee.account,
      costCenterId: fee.costCenterId,
      quantity: 1,
      unitPrice: -f.amount,
      effectiveDiscount: 0,
      total: -f.amount,
      unmatched: false,
    });
  }
  return days.list();
}

/** A Swish export's payments as one report per day. */
export function routeSwishPayments(
  table: RoutingTable,
  payments: readonly SwishPayment[],
): IncomeDayDto[] {
  const pattern = prefixPattern(table);
  const days = new Days();
  for (const p of payments) {
    const { route, name, unmatched } = routePayment(table, pattern, p);
    days.add(
      p.date,
      saleLine(route, name, unmatched, {
        quantity: 1,
        unitPrice: p.amount,
        effectiveDiscount: 0,
        total: p.amount,
      }),
    );
  }
  return days.list();
}
