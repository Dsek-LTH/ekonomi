// Routing: which verksamhet a sale is, which account it is credited to, and
// which cost centre it books against.
//
// The one place this is decided. intakt used to do it, from a copy of the
// routing table sent with every request, while this app corrected its mistakes
// afterwards (lib/income/lines.ts), so the rule lived in two places and the two
// could disagree. The sharpest case was the reserv: the app let a treasurer
// mark any prefix as the reserv and never sent the flag, and intakt routed
// every unknown product to whichever prefix happened to be called "sk". Now the
// service returns sales as rung up and everything about meaning is here.
//
// Pure: a table in, sales in, reports out, so it is tested without a database.
// lib/income/config.ts builds the table from the settings.
//
// Ported from intakt's report/purchases.go and report/swish.go with two
// deliberate differences. Prefixes match in any case, where intakt matched only
// all-lower or all-upper ("Ca - Kaffe" fell through to the reserv). And longer
// prefixes are tried first, where intakt's order was Go's map order, so which
// of two overlapping prefixes won could change from one run to the next.
import type {
  IncomeDayDto,
  IncomeDayLine,
  SwishPayment,
  ZettleFee,
  ZettleSaleLine,
} from "./types";

/**
 * Where a sale is booked: a verksamhet by its income key, an account, and a
 * cost centre. The cost centre is already resolved when the table is built
 * (lib/income/config.ts): the prefix's own if it has one, else the
 * verksamhet's default, else none.
 */
export interface Route {
  key: string;
  account: string;
  costCenterId: string | null;
}

/** Where Zettle's fees book. Nobody's sales, so not a route. */
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

// Between the prefix and the product: any run of hyphens, en or em dashes and
// spaces, so "c-Cola", "c - Cola" and "c \u2013 Cola" all read the same.
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

/**
 * What a product rung up with no name at all is called. A custom amount typed
 * into the till comes through that way, and a blank row in the review table
 * and on the intäktsräkning would read as a rendering fault.
 */
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

    // The same product at the same price, for the same verksamhet, on the same
    // account and cost centre, is one line with its quantity summed: a day of
    // colas is "Cola, 40", not forty rows. Anything that would put two of them
    // on different voucher rows keeps them apart.
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
  rest: Pick<
    IncomeDayLine,
    "variant" | "quantity" | "unitPrice" | "effectiveDiscount" | "total"
  >,
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
 * A Zettle range as one report per day: every verksamhet's sales, and the
 * day's fees.
 *
 * The fees are lines of the same day because they leave the same account the
 * sales land in. Zettle pays out takings net of its fees, so a day whose
 * voucher carries both moves the clearing account by what Zettle actually
 * sends. Equal fees are one line with a count. A fee line's total is negative,
 * since it takes money out of the clearing account. A fee Zettle paid back
 * (a refunded purchase takes its fee with it) is positive.
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
