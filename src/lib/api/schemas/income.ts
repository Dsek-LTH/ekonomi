// Request bodies for the income (intäkter) routes.
import { z } from "zod";

import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed, UpperCode } from "./common";
// A voucher row is the same whatever it substantiates; declared with the utlägg bodies.
import { VoucherLineInput } from "./expense";

/** A BAS account number as stored: digits, kept as a string. Shared by the routing table and corrected lines. */
const AccountNumber = Trimmed.regex(/^\d{4,6}$/);

/** Fetch a range from Zettle: sales and fees, one report per day. SWISH is an uploaded file with its own route. */
export const FetchIncome = z.object({
  from: IsoDate,
  to: IsoDate,
});

/**
 * Correct where sold lines book: whose sale, which account, which cost centre. Absent means unchanged. Amounts are
 * deliberately absent: they are the till's word and the document is rendered from these lines. See lib/income/lines.ts.
 * Changing the verksamhet without a cost centre gives the line that verksamhet's routing default (its prefix's for the
 * account, else its default).
 */
export const UpdateIncomeLines = z.object({
  lines: z
    .array(
      z.object({
        id: Id,
        resultUnitId: Id.optional(),
        account: AccountNumber.optional(),
        costCenterId: Clearable(Id).optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/** A kontering written by hand for a day: every row but the clearing account, which is the day's total. See lib/income/manual-voucher.ts. */
export const SaveIncomeVoucher = z.object({
  lines: z.array(VoucherLineInput).min(1).max(200),
});

// ── The routing table (settings) ──────────────────────────────────
// intakt's config.yaml made editable: validation keeps a voucher from booking against something that does not exist.

/** A product-name prefix, stored lower-case (matching is case-insensitive; both cases would be two rows). */
const PrefixCode = Trimmed.min(1)
  .max(16)
  .transform((s) => s.toLowerCase());

/** Give a resultatenhet an income profile. The unit itself is created under Inställningar → Resultatenheter. */
export const CreateIncomeUnit = z.object({
  resultUnitId: Id,
  description: Trimmed.default(""),
  /** Only for a unit whose documents need a different form of its name. */
  properName: Clearable(NonEmpty).optional(),
  defaultCostCenterId: Clearable(Id).optional(),
});

export const UpdateIncomeUnit = z.object({
  properName: Clearable(NonEmpty).optional(),
  description: Trimmed.optional(),
  defaultCostCenterId: Clearable(Id).optional(),
  active: z.boolean().optional(),
});

export const CreateIncomePrefix = z.object({
  code: PrefixCode,
  /** The income profile it routes to, ResultUnitIncome.id. */
  incomeId: Id,
  account: AccountNumber,
  /** Its own cost centre. Left out or cleared, the verksamhet's default. */
  costCenterId: Clearable(Id).optional(),
});

export const UpdateIncomePrefix = z.object({
  incomeId: Id.optional(),
  account: AccountNumber.optional(),
  costCenterId: Clearable(Id).optional(),
});

/** A Swish payment matched by exact amount when its message says nothing usable; the message goes through the normal prefix pipeline. */
export const UpsertSwishFallback = z.object({
  amount: Ore.positive(),
  message: NonEmpty,
});

/** Where income lands, and what Zettle's own fees cost. */
export const UpdateIncomeSettings = z.object({
  zettleClearingAccount: AccountNumber.optional(),
  swishClearingAccount: AccountNumber.optional(),
  zettleFeeAccount: AccountNumber.optional(),
  zettleFeeCostCenterId: Clearable(Id).optional(),
  /** Which verifikationsserie takings export to. Cleared (empty string) means the Fortnox connection's. Upper-cased. */
  incomeVoucherSeries: Clearable(UpperCode).optional(),
  /** Where a sale matching no prefix goes: a verksamhet's income profile and the account credited. See BookkeepingSettings. */
  incomeFallbackIncomeId: Clearable(Id).optional(),
  incomeFallbackAccount: AccountNumber.optional(),
});
