// Request bodies for everything under /api/expenses.
//
// Shared with the wizard and the detail page, so the shape a screen sends and
// the shape the route accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Clearable, Id, IsoDate, NonEmpty, Ore, Trimmed, UpperCode } from "./common";
import { MAX_REMINDER_ITEMS } from "@/lib/domain/reminders";

const PaymentType = z.enum(["CARD", "REIMBURSEMENT", "MILEAGE"]);

/** POST /api/expenses: opens a draft for the wizard to attach a receipt to. */
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
 * A total odometer reading, in kilometres. The car's lifetime figure, not the
 * trip meter; see the columns on the Expense model for why that distinction is
 * the whole point of recording readings at all.
 *
 * One decimal, matching the column, because some dashboards show one. Not
 * negative, and bounded well past what any car reaches, because a slipped digit
 * here is a slipped digit in an amount.
 *
 * Zero is a real reading: a car straight off the lot. So the two are
 * `Clearable` rather than falsy-checked anywhere, "not given yet" is null, and
 * a draft is allowed to have one.
 */
const Odometer = z.number().min(0).max(9_999_999).multipleOf(0.1);

/**
 * One stop on a journey, as somebody writes it.
 *
 * Capped because it goes on the utläggsräkning, where a paragraph in a table
 * cell is a broken page rather than a better underlag. Long enough for a street
 * address with a town after it.
 */
const Place = Trimmed.max(120);

/**
 * PATCH /api/expenses/[id].
 *
 * Every field is optional because this patches: absent means "leave it", and
 * the route fills from the stored row. `purchaseDate` and `grossAmount` are
 * additionally clearable, since a draft is allowed to not have them yet, which
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
   * a client's to decide, so a request that carries these has its
   * `grossAmount` written from them whatever else it said.
   *
   * Clearable, because a draft may hold one reading and not the other, and
   * because taking one back out is something somebody correcting a typo does.
   */
  odometerStart: Clearable(Odometer).optional(),
  odometerEnd: Clearable(Odometer).optional(),
  /**
   * Every place the car stopped, in the order it stopped there.
   *
   * Sent whole rather than patched per stop: it is a list whose order carries
   * the meaning, and "change stop 2" is not something a client can express
   * without the two ends agreeing on what stop 2 was. Absent leaves the stored
   * list alone; an empty array is a draft with nothing filled in yet.
   *
   * Blank entries are allowed through, because an editor with three rows and
   * the middle one cleared is a real state to save a draft from. `claimBlocker`
   * is what counts the ones that name a place.
   *
   * Capped so a claim cannot carry an unbounded list into a typeset page.
   * Twenty stops is far past any errand and well short of a denial of service.
   */
  journeyStops: z.array(Place).max(20).optional(),
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
    // The submitter taking their own claim back out of the queue, apart from
    // "withdraw_attest", which is an attester taking back a signature.
    "recall",
    "request_changes",
    "approve",
    "withdraw_attest",
    "return_approved",
    "unexport",
    // Dispens från redovisningsfristen: letting one late eget utlägg be filed
    // anyway, and taking that back. Neither moves the status, so neither is in
    // SIMPLE_TRANSITIONS, but both are acts performed on an utlägg by somebody
    // with the standing to, which is what this endpoint is.
    "waive_deadline",
    "revoke_deadline_waiver",
  ]),
  comment: Trimmed.default(""),
});
export type TransitionExpense = z.infer<typeof TransitionExpense>;

/** POST /api/expenses/[id]/match: `null` unmatches. */
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
  // the key being absent but not the null a cleared field actually sends, so
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
  // The utlägg's updatedAt as the booking screen loaded it. The write only
  // lands if it still is, so a colleague who booked or amended it in the
  // meantime turns this request into a 409 instead of being overwritten.
  expectedUpdatedAt: z.iso.datetime(),
  lines: z.array(VoucherLineInput).default([]),
  date: IsoDate.optional(),
  description: Trimmed.optional(),
});
export type BookVoucher = z.infer<typeof BookVoucher>;

/**
 * PUT /api/expenses/[id]/presence: the booking screen's heartbeat. `active` is
 * false once its user has gone idle, which takes them off the screen for
 * everybody else while still answering whether the utlägg has moved on.
 */
export const PresenceHeartbeat = z.object({
  active: z.boolean(),
});
export type PresenceHeartbeat = z.infer<typeof PresenceHeartbeat>;

/**
 * POST /api/expenses/[id]/export/resolve: what somebody found when they looked
 * in Fortnox for an export that ended without an answer.
 *
 *   none     no voucher was made. The lock is let go, so it can be exported
 *            again. Why they are sure is required, since being wrong files it
 *            twice.
 *   exists   it was made, with this series and number. Recorded as exported,
 *            exactly as the export would have.
 */
export const ResolveExport = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("none"), comment: NonEmpty }),
  z.object({
    outcome: z.literal("exists"),
    series: UpperCode.pipe(z.string().min(1)),
    number: z.int().positive(),
    comment: Trimmed.optional(),
  }),
]);
export type ResolveExport = z.infer<typeof ResolveExport>;

/**
 * POST /api/reminders: remind whoever each of these is waiting on. Utlägg, from
 * one's own page or picked on a list, and card purchases with no utlägg,
 * picked on the bank list. The message is optional and quoted at the top of
 * every mail it sends.
 */
export const SendReminders = z
  .object({
    expenseIds: z.array(Id).default([]),
    transactionIds: z.array(Id).default([]),
    message: Clearable(Trimmed.max(2000)).optional(),
  })
  .refine((b) => b.expenseIds.length + b.transactionIds.length > 0, {
    message: "nothing picked",
  })
  .refine((b) => b.expenseIds.length + b.transactionIds.length <= MAX_REMINDER_ITEMS, {
    message: "too many picked",
  });
export type SendReminders = z.infer<typeof SendReminders>;

/** PUT /api/expenses/[id]/receipts/order: every document's id, in the order wanted. */
export const ReorderReceipts = z.object({
  ids: z.array(Id).min(1),
});
export type ReorderReceipts = z.infer<typeof ReorderReceipts>;
