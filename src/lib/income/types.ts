// The income pipeline's shapes. The wire types are hand-written counterparts to Go structs in the
// intakt repository (report.SaleLine, report.Fee, report.SwishPayment) and the service rejects
// unknown fields. Every amount is öre.

/** One sold line of a day, as routing leaves it. Amounts in öre. */
export interface IncomeDayLine {
  /** A sale, or one of Zettle's fees for the day. */
  kind: "SALE" | "FEE";
  /** The verksamhet's income key. Null on a fee, which is nobody's. */
  unitKey: string | null;
  /** The product as rung up, prefix stripped. */
  name: string;
  variant?: string;
  /** BAS account: revenue for a sale, the fee account for a fee. */
  account: string;
  /** Where it books. Null when neither the prefix nor the verksamhet names one. */
  costCenterId: string | null;
  quantity: number;
  unitPrice: number;
  effectiveDiscount: number;
  /** quantity * unitPrice - discount. Negative for a refund or a fee. */
  total: number;
  /** Matched no prefix and went to the reserv. */
  unmatched: boolean;
}

/** One source's day, as routing leaves it. */
export interface IncomeDayDto {
  /** ISO date, the Swedish day it was sold. */
  date: string;
  lines: IncomeDayLine[];
  /** The lines' sum: what the day moves the clearing account by. */
  total: number;
}

/** A revenue or fee account and what the lines on it come to. */
export interface IncomeAccountDistribution {
  account: string;
  description: string;
  total: number;
}

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
