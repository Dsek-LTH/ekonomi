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
 * it: the routing table says where a product's money lands, and a line moved
 * between verksamheter says the same thing about one sale.
 */
const AccountNumber = Trimmed.regex(/^\d{4,6}$/);

/**
 * Fetch a range from Zettle. SWISH is not here on purpose: it arrives as an
 * uploaded file rather than a JSON body, and has its own route.
 */
export const FetchIncome = z.object({
  source: z.enum(["ZETTLE", "ZETTLE_FEE"]),
  from: IsoDate,
  to: IsoDate,
});
export type FetchIncomeInput = z.infer<typeof FetchIncome>;

/**
 * Make an empty report for a verksamhet's day, to move sales onto. See
 * lib/income/draft.ts.
 *
 * Three fields and no amounts, because there is nothing on it yet: what it holds
 * arrives by moving lines from the report the routing wrongly put them in. The
 * source is Zettle or Swish and never ZETTLE_FEE, which belongs to no
 * verksamhet and is never split.
 */
export const CreateIncomeReport = z.object({
  source: z.enum(["ZETTLE", "SWISH"]),
  date: IsoDate,
  resultUnitId: Id,
});
export type CreateIncomeReportInput = z.infer<typeof CreateIncomeReport>;

/**
 * What a treasurer may change about a fetched report before it is booked.
 *
 * The amounts are deliberately absent. A report is what the till and the bank
 * say was sold; correcting it here would mean the voucher and the evidence
 * behind it disagreed, and the PDF is rendered from these same lines. Something
 * genuinely wrong is a matter for a correcting voucher, not an edit.
 */
export const UpdateIncomeReport = z.object({
  costCenterId: Clearable(Id).optional(),
});
export type UpdateIncomeReportInput = z.infer<typeof UpdateIncomeReport>;

/**
 * Book a day's takings, optionally with the voucher the bookkeeper edited.
 *
 * No lines means "book what the report says", the rows the app derives from
 * the day's account distributions, which is what the bulk "book all" sends and
 * what the great majority of days need.
 *
 * Neither the date nor the description is here, unlike the utlägg version of
 * this body. Both are the day's identity rather than anybody's choice: the date
 * is which day was sold, and the description is how this app recognises the day
 * in Fortnox (lib/income/duplicate.ts). A hand-edited one would be a day the
 * duplicate check could no longer see.
 */
export const BookIncomeReport = z.object({
  lines: z.array(VoucherLineInput).default([]),
});
export type BookIncomeReportInput = z.infer<typeof BookIncomeReport>;

/**
 * Move sold lines onto another verksamhet's report for the same day: a product
 * rung up without its prefix, which the routing therefore sent to the fallback.
 * See lib/income/move.ts.
 *
 * The account is per line rather than per move because a day's mis-sales are
 * not all the same thing: beer and food belong to the same verksamhet and to
 * different revenue accounts. Left out, a line keeps the one the routing gave
 * it, which is the fallback's, and usually wrong, so the screen fills it in.
 */
export const MoveIncomeLines = z.object({
  toResultUnitId: Id,
  lines: z
    .array(z.object({ id: Id, account: AccountNumber.optional() }))
    .min(1)
    .max(2000),
});
export type MoveIncomeLinesInput = z.infer<typeof MoveIncomeLines>;

/**
 * Re-account sold lines where they are.
 *
 * The account and nothing else: what was sold, how many and for how much are
 * the till's word, and none of them is editable. See the note on
 * UpdateIncomeReport. Where the money books is this app's own routing, and
 * routing is what a mistyped prefix gets wrong.
 */
export const UpdateIncomeLines = z.object({
  lines: z.array(z.object({ id: Id, account: AccountNumber })).min(1).max(2000),
});
export type UpdateIncomeLinesInput = z.infer<typeof UpdateIncomeLines>;

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
const PrefixCode = Trimmed.min(1).max(16).transform((s) => s.toLowerCase());

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
export type CreateIncomeUnitInput = z.infer<typeof CreateIncomeUnit>;

export const UpdateIncomeUnit = z.object({
  properName: Clearable(NonEmpty).optional(),
  description: Trimmed.optional(),
  defaultCostCenterId: Clearable(Id).optional(),
  active: z.boolean().optional(),
});
export type UpdateIncomeUnitInput = z.infer<typeof UpdateIncomeUnit>;

export const CreateIncomePrefix = z.object({
  code: PrefixCode,
  /** The income profile it routes to, ResultUnitIncome.id. */
  incomeId: Id,
  account: AccountNumber,
  isFallback: z.boolean().optional(),
});
export type CreateIncomePrefixInput = z.infer<typeof CreateIncomePrefix>;

export const UpdateIncomePrefix = z.object({
  incomeId: Id.optional(),
  account: AccountNumber.optional(),
  isFallback: z.boolean().optional(),
});
export type UpdateIncomePrefixInput = z.infer<typeof UpdateIncomePrefix>;

/**
 * A Swish payment matched by exact amount when its message says nothing usable.
 * The message is fed through the normal prefix pipeline, so "c-Cola" routes
 * exactly as a labelled payment would.
 */
export const UpsertSwishFallback = z.object({
  amount: Ore.positive(),
  message: NonEmpty,
});
export type UpsertSwishFallbackInput = z.infer<typeof UpsertSwishFallback>;

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
});
export type UpdateIncomeSettingsInput = z.infer<typeof UpdateIncomeSettings>;
