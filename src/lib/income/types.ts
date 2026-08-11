// The wire format of the intakt service.
//
// These are hand-written counterparts to Go structs in another repository —
// report.Report and config.Config — so nothing but care keeps them in step.
// Two things make that survivable. The service rejects unknown fields, so a
// name misspelled here fails loudly on the first request rather than silently
// dropping a value; and the shapes are pinned by a test (client.test.ts)
// against a recorded response, so a change on the far side shows up as a
// failing assertion rather than as an undefined at runtime.
//
// Every amount is öre, matching both the service and the database. Nothing here
// is kronor.

/** One product line of a report. */
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
 * verifikation, which is why they must sum to the report total — see
 * lib/income/voucher.ts, which checks exactly that before booking.
 */
export interface IncomeAccountDistribution {
  account: string;
  description: string;
  total: number;
}

/** One committee's takings for one day: one PDF, one voucher. */
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
export interface IncomeFeeEntry {
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

// ── The configuration the service is sent ─────────────────────────
//
// snake_case, because these mirror the YAML keys intakt's Config carries on
// both its yaml and json tags. It is the only place in this app that spells
// fields that way, and it is not a style slip — it is the other side's format.

export interface IntaktAttestation {
  name: string;
  stil_id: string;
}

export interface IntaktPrefix {
  /** The committee key this prefix routes to. */
  name: string;
  /** BAS revenue account, as a number — the Go field is an int. */
  account: number;
}

export interface IntaktCommittee {
  proper_name: string;
  description: string;
  default_cost_center: string;
}

export interface IntaktConfig {
  attestation: IntaktAttestation;
  account_descriptions: Record<string, string>;
  prefix_mappings: Record<string, IntaktPrefix>;
  committees: Record<string, IntaktCommittee>;
  /** Keyed by amount in öre, as a string — JSON has no integer keys. */
  swish_amount_fallbacks: Record<string, string>;
}

/** What appears under the heading of a rendered report. */
export type IncomePaymentType = "Zettle" | "Swish";
