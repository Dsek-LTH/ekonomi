// Routing: which verksamhet a sale is, and which account it is credited to.
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
  IncomeAccountDistribution,
  IncomeFeeReportDto,
  IncomeProduct,
  IncomeReportDto,
  SwishPayment,
  ZettleFee,
  ZettleSaleLine,
} from "./types";

/** Where a sale is booked: a verksamhet by its income key, and an account. */
export interface Route {
  key: string;
  account: string;
}

export interface RoutingTable {
  /** Product-name prefix, lower-case, to where it routes. */
  prefixes: ReadonlyMap<string, Route>;
  /** Where a sale matching no prefix goes. See BookkeepingSettings. */
  fallback: Route;
  /** Swish amount in öre to a message to route as, for an unlabelled payment. */
  swishAmountGuesses: ReadonlyMap<number, string>;
  /** Account number to its name in the chart, for the distributions. */
  accountNames: ReadonlyMap<string, string>;
}

// Between the prefix and the product: any run of hyphens, en or em dashes and
// spaces, so "c-Cola", "c - Cola" and "c \u2013 Cola" all read the same.
const SEPARATOR = "[-\u2013\u2014 ]+";

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The pattern that splits a name into its prefix and the rest. */
function prefixPattern(table: RoutingTable): RegExp | null {
  if (table.prefixes.size === 0) return null;
  const codes = [...table.prefixes.keys()].sort((a, b) => b.length - a.length || a.localeCompare(b));
  return new RegExp(`^(${codes.map(escape).join("|")})${SEPARATOR}(.+?)$`, "i");
}

/** Where `text` routes by its prefix, and the name without it, or null. */
function byPrefix(table: RoutingTable, pattern: RegExp | null, text: string) {
  const m = pattern?.exec(text.trim());
  if (!m) return null;
  const route = table.prefixes.get(m[1].toLowerCase());
  return route ? { route, name: m[2].trim() } : null;
}

/** A Zettle product: by its prefix, or to the reserv under its full name. */
function routeProduct(table: RoutingTable, pattern: RegExp | null, name: string) {
  return byPrefix(table, pattern, name) ?? { route: table.fallback, name: name.trim() };
}

/**
 * A Swish payment: by its message's prefix, then by the guess kept for its
 * exact amount, and only then to the reserv, under the message as written.
 */
function routePayment(table: RoutingTable, pattern: RegExp | null, p: SwishPayment) {
  const direct = byPrefix(table, pattern, p.message);
  if (direct) return direct;
  const guess = table.swishAmountGuesses.get(p.amount);
  const guessed = guess ? byPrefix(table, pattern, guess) : null;
  return guessed ?? { route: table.fallback, name: p.message.trim() };
}

/** Reports being built, by "<key>-<date>". */
class Reports {
  private byKey = new Map<string, IncomeReportDto>();

  constructor(private readonly accountNames: ReadonlyMap<string, string>) {}

  add(route: Route, date: string, line: IncomeProduct) {
    const key = `${route.key}-${date}`;
    let report = this.byKey.get(key);
    if (!report) {
      report = { key, committee: route.key, date, products: [], total: 0, accountDistributions: [] };
      this.byKey.set(key, report);
    }

    // The same product at the same price on the same account is one line, its
    // quantity summed: a day of colas is "Cola, 40", not forty rows.
    const same = report.products.find(
      (p) =>
        p.name === line.name &&
        (p.variant ?? "") === (line.variant ?? "") &&
        p.account === line.account &&
        p.unitPrice === line.unitPrice &&
        Boolean(p.isDiscount) === Boolean(line.isDiscount),
    );
    if (same) {
      same.quantity += line.quantity;
      same.effectiveDiscount += line.effectiveDiscount;
      same.total += line.total;
    } else {
      report.products.push({ ...line });
    }
    report.total += line.total;
    addDistribution(report.accountDistributions, line.account, line.total, this.accountNames);
  }

  /** Sorted by key, so the same fetch always comes back in the same order. */
  list(): IncomeReportDto[] {
    return [...this.byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  }
}

function addDistribution(
  distributions: IncomeAccountDistribution[],
  account: string,
  amount: number,
  names: ReadonlyMap<string, string>,
) {
  const existing = distributions.find((d) => d.account === account);
  if (existing) existing.total += amount;
  else distributions.push({ account, description: names.get(account) ?? "", total: amount });
}

/** Zettle's lines as one report per verksamhet and day. */
export function routeZettleSales(table: RoutingTable, lines: readonly ZettleSaleLine[]): IncomeReportDto[] {
  const pattern = prefixPattern(table);
  const reports = new Reports(table.accountNames);
  for (const line of lines) {
    const { route, name } = routeProduct(table, pattern, line.name);
    reports.add(route, line.date, {
      name,
      ...(line.variant ? { variant: line.variant } : {}),
      account: route.account,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      effectiveDiscount: line.discount,
      total: line.total,
    });
  }
  return reports.list();
}

/** A Swish export's payments as one report per verksamhet and day. */
export function routeSwishPayments(table: RoutingTable, payments: readonly SwishPayment[]): IncomeReportDto[] {
  const pattern = prefixPattern(table);
  const reports = new Reports(table.accountNames);
  for (const p of payments) {
    const { route, name } = routePayment(table, pattern, p);
    reports.add(route, p.date, {
      name,
      account: route.account,
      quantity: 1,
      unitPrice: p.amount,
      effectiveDiscount: 0,
      total: p.amount,
    });
  }
  return reports.list();
}

/**
 * Zettle's fees as one report per day, on the fee account.
 *
 * Not routed: a fee belongs to whoever runs the terminal, not to a verksamhet.
 * Fees of the same size are one line with a count, as intakt drew them.
 */
export function groupZettleFees(fees: readonly ZettleFee[], account: string): IncomeFeeReportDto[] {
  const byDate = new Map<string, IncomeFeeReportDto>();
  for (const fee of fees) {
    if (fee.amount === 0) continue;
    let report = byDate.get(fee.date);
    if (!report) {
      report = { key: fee.date, date: fee.date, fees: [], total: 0 };
      byDate.set(fee.date, report);
    }
    const same = report.fees.find((f) => f.unitPrice === fee.amount);
    if (same) {
      same.quantity += 1;
      same.total += fee.amount;
    } else {
      report.fees.push({ name: "Zettle fee", account, quantity: 1, unitPrice: fee.amount, total: fee.amount });
    }
    report.total += fee.amount;
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
