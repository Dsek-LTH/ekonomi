// Request bodies for the income (intäkter) routes.
import { z } from "zod";

import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed, UpperCode } from "./common";
// A voucher row is a voucher row whatever it substantiates: same fields, same
// units, same rules. Declared with the utlägg bodies because that is where the
// first one was written.
import { VoucherLineInput } from "./expense";

/**
 * A BAS account number as it is stored: digits, kept as a string.
 *
 * Up here rather than with the settings bodies below because both halves need
 * it: the routing table says where a product's money lands, and a corrected
 * line says the same thing about one sale.
 */
const AccountNumber = Trimmed.regex(/^\d{4,6}$/);

/**
 * Fetch a range from Zettle: the sales and that range's fees, as one report per
 * day. SWISH is not here on purpose: it arrives as an uploaded file rather than
 * a JSON body, and has its own route.
 */
export const FetchIncome = z.object({
  from: IsoDate,
  to: IsoDate,
});

/**
 * Correct where sold lines book: whose sale it was, which account, which cost
 * centre. Each field is optional and left out means unchanged.
 *
 * The amounts are deliberately absent. What was sold, how many and for how
 * much are the till's word; correcting them here would mean the voucher and the
 * evidence behind it disagreed, since the document is rendered from these same
 * lines. Where the money books is this app's own routing, and routing is what a
 * mistyped prefix gets wrong. See lib/income/lines.ts.
 *
 * Changing the verksamhet without naming a cost centre gives the line the one
 * that verksamhet's routing would have: its prefix's for that account, else its
 * default.
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

/**
 * A kontering written by hand for a day: every row but the clearing account,
 * which is always the day's total. See lib/income/manual-voucher.ts.
 */
export const SaveIncomeVoucher = z.object({
  lines: z.array(VoucherLineInput).min(1).max(200),
});

// ── The routing table (settings) ──────────────────────────────────
//
// This is intakt's config.yaml, made editable. Everything here decides where a
// sold product's money lands, so the validation is about keeping a voucher from
// being booked against something that does not exist.

/**
 * A product-name prefix. Stored lower-case, because matching is
 * case-insensitive and storing both cases would make "C" and "c" two rows that
 * could route two ways.
 */
const PrefixCode = Trimmed.min(1)
  .max(16)
  .transform((s) => s.toLowerCase());

/**
 * Give a resultatenhet an income profile: the settings that let it take money
 * in. The unit itself is created under Inställningar → Resultatenheter: there
 * is one register of the section's verksamheter, and this is the half of a row
 * in it that income needs.
 */
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

/**
 * A Swish payment matched by exact amount when its message says nothing usable.
 * The message is fed through the normal prefix pipeline, so "c-Cola" routes
 * exactly as a labelled payment would.
 */
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
  /**
   * Which verifikationsserie takings are exported to. Cleared, the empty
   * string, means the one the Fortnox connection uses, which is what income
   * did before this setting existed. Upper-cased like every other series in
   * the app, so "b" and "B" cannot become two.
   */
  incomeVoucherSeries: Clearable(UpperCode).optional(),
  /**
   * Where a sale matching no prefix goes: a verksamhet's income profile, and
   * the account it is credited to. See BookkeepingSettings.
   */
  incomeFallbackIncomeId: Clearable(Id).optional(),
  incomeFallbackAccount: AccountNumber.optional(),
});
