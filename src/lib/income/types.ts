// The income pipeline's shapes: what the intakt service sends and is sent, and
// the reports the app routes those sales into.
//
// The wire half are hand-written counterparts to Go structs in another
// repository (report.SaleLine, report.Fee, report.SwishPayment and
// report.Document), so nothing but care keeps them in step. The service rejects
// unknown fields, so a name misspelled here fails loudly on the first request
// rather than silently dropping a value.
//
// Every amount is öre, matching both the service and the database. Nothing here
// is kronor.

/** One product line of a routed report. */
export interface IncomeProduct {
  name: string;
  variant?: string;
  /** BAS revenue account this line routed to, e.g. "3011". */
  account: string;
  quantity: number;
  unitPrice: number;
  /** This line's share of any purchase-level discount, already prorated. */
  effectiveDiscount: number;
  /** quantity*unitPrice - effectiveDiscount. */
  total: number;
  isDiscount?: boolean;
}

/**
 * A report's totals per account. These become the credit rows of the
 * verifikation, which is why they must sum to the report total. See
 * lib/income/voucher.ts, which checks exactly that before booking.
 */
export interface IncomeAccountDistribution {
  account: string;
  description: string;
  total: number;
}

/**
 * One verksamhet's takings for one day: one PDF, one voucher. Built by the
 * app's own routing (./routing.ts) from the raw lines below.
 */
export interface IncomeReportDto {
  /** "<committee>-<date>", the key the service files it under. */
  key: string;
  /** The committee key, matching IncomeCommittee.key. */
  committee: string;
  /** YYYY-MM-DD. */
  date: string;
  products: IncomeProduct[];
  total: number;
  accountDistributions: IncomeAccountDistribution[];
}

/** One of Zettle's own transaction fees, which are a cost rather than income. */
interface IncomeFeeEntry {
  name: string;
  account: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface IncomeFeeReportDto {
  key: string;
  date: string;
  fees: IncomeFeeEntry[];
  total: number;
}

// ── What the service sends ─────────────────────────────────────────

/** One product line of one Zettle purchase, as rung up. See report.SaleLine. */
export interface ZettleSaleLine {
  purchaseId: string;
  /** YYYY-MM-DD, Swedish local day. */
  date: string;
  /** As rung up, prefix included. Splitting it off is routing, and ours. */
  name: string;
  variant?: string;
  quantity: number;
  unitPrice: number;
  /** The product's own discount plus its share of a purchase-level one. */
  discount: number;
  total: number;
}

/** One of Zettle's payment fees, as a positive cost. */
export interface ZettleFee {
  date: string;
  amount: number;
}

/** One payment row of a Swish export. */
export interface SwishPayment {
  date: string;
  /** Free text, usually "<prefix> - <product>". */
  message: string;
  amount: number;
}

// ── What the service is sent ───────────────────────────────────────

/**
 * Everything a rendered intäktsräkning shows, handed over whole. See
 * report.Document. Names rather than keys, so the service renders without
 * knowing anything about the section.
 */
export interface IncomeDocument {
  kind: "income" | "fee";
  paymentType: IncomePaymentType;
  /** Whose takings, as the page names them. */
  unit: string;
  /** The verifikationstext. */
  description: string;
  date: string;
  attestation: { name: string; stilId: string };
  lines: IncomeProduct[];
  distributions: IncomeAccountDistribution[];
  total: number;
}

/** What appears under the heading of a rendered report. */
export type IncomePaymentType = "Zettle" | "Swish";
