// Request bodies for everything under /api/expenses.
//
// Shared with the wizard and the detail page, so the shape a screen sends and
// the shape the route accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";

const PaymentType = z.enum(["CARD", "REIMBURSEMENT", "MILEAGE"]);

/** POST /api/expenses — opens a draft for the wizard to attach a receipt to. */
export const CreateExpense = z.object({
  // Anything other than REIMBURSEMENT used to fall through to CARD, including a
  // typo. It is one of the three or it is a bad request.
  paymentType: PaymentType.default("CARD"),
  title: Trimmed.default(""),
  matchedTransactionId: Clearable(Id).optional(),
});
export type CreateExpense = z.infer<typeof CreateExpense>;

/** One cost-centre slice of an utlägg. Amounts in öre, like the gross. */
export const AllocationInput = z.object({
  costCenterCode: Trimmed,
  amount: Ore,
  comment: Trimmed.optional(),
});
export type AllocationInput = z.infer<typeof AllocationInput>;

/**
 * An odometer reading, in kilometres.
 *
 * One decimal, matching the column — a trip meter has one and plenty of
 * dashboards show it. Not negative, and bounded well past what any car reaches,
 * because a slipped digit here is a slipped digit in an amount.
 *
 * Zero is a real reading: a trip meter that was just zeroed, and a car straight
 * off the lot. So the two are `Clearable` rather than falsy-checked anywhere —
 * "not given yet" is null, and a draft is allowed to have one.
 */
const Odometer = z.number().min(0).max(9_999_999).multipleOf(0.1);

/**
 * PATCH /api/expenses/[id].
 *
 * Every field is optional because this patches: absent means "leave it", and
 * the route fills from the stored row. `purchaseDate` and `grossAmount` are
 * additionally clearable, since a draft is allowed to not have them yet — which
 * is why they are `Clearable` rather than merely optional, and why the two are
 * different things here.
 */
export const PatchExpense = z.object({
  title: NonEmpty.optional(),
  purchaseDate: Clearable(IsoDate).optional(),
  grossAmount: Clearable(Ore).optional(),
  paymentType: PaymentType.optional(),
  allocations: z.array(AllocationInput).optional(),
  /**
   * The odometer at each end of the journey, for a milersättning.
   *
   * No distance and no amount: what the claim is worth is the server's to work
   * out from the difference and the rate in force on the day of the journey
   * (lib/mileage/claim.ts). Sending either would be sending the one figure on
   * the whole form that decides how much money leaves the section, which is not
   * a client's to decide — so a request that carries these has its
   * `grossAmount` written from them whatever else it said.
   *
   * Clearable, because a draft may hold one reading and not the other, and
   * because taking one back out is something somebody correcting a typo does.
   */
  odometerStart: Clearable(Odometer).optional(),
  odometerEnd: Clearable(Odometer).optional(),
});
export type PatchExpense = z.infer<typeof PatchExpense>;

/**
 * POST /api/expenses/[id]/transition.
 *
 * The action is an enum rather than a string: an unknown one used to fall past
 * every branch to a 400 at the bottom, which worked, but meant the list of what
 * this endpoint does was something you assembled by reading it.
 */
export const TransitionExpense = z.object({
  action: z.enum([
    "submit",
    // The submitter taking their own claim back out of the queue — apart from
    // "withdraw_attest", which is an attester taking back a signature.
    "recall",
    "request_changes",
    "approve",
    "withdraw_attest",
    "return_approved",
    "unexport",
  ]),
  comment: Trimmed.default(""),
});
export type TransitionExpense = z.infer<typeof TransitionExpense>;

/** POST /api/expenses/[id]/match — `null` unmatches. */
export const MatchExpense = z.object({
  transactionId: Clearable(Id),
});
export type MatchExpense = z.infer<typeof MatchExpense>;

/** One row of a verification. Debit and credit in öre, never negative. */
export const VoucherLineInput = z.object({
  account: Trimmed.default(""),
  accountName: Trimmed.default(""),
  // Clearable like the cost centre beside it, and for the same reason: a row
  // with nothing written on it sends null, and "no description" is not a
  // malformed request. It was `Trimmed.optional()`, which accepts a string or
  // the key being absent but not the null a cleared field actually sends — so
  // booking an utlägg whose second row had no text was refused outright, with
  // `lines.1.description` as the only clue. Both ends already agreed on the
  // meaning: the route stores `description || null`, and the column is
  // nullable. Only the schema disagreed.
  description: Clearable(Trimmed).optional(),
  costCenterCode: Clearable(Trimmed).optional(),
  debit: Ore.min(0).default(0),
  credit: Ore.min(0).default(0),
});
export type VoucherLineInput = z.infer<typeof VoucherLineInput>;

/** POST and PATCH /api/expenses/[id]/book. */
export const BookVoucher = z.object({
  lines: z.array(VoucherLineInput).default([]),
  date: IsoDate.optional(),
  description: Trimmed.optional(),
});
export type BookVoucher = z.infer<typeof BookVoucher>;
