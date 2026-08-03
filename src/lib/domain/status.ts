import { daysAgo, isCompleteDate, isFutureDate } from "@/lib/domain/date";
import type { ExpenseStatus, PaymentType } from "@/lib/domain/types";

// How long a member has to hand in an utlägg they paid out of their own pocket,
// counted from the day of the purchase and inclusive: a receipt 60 days old is
// still in time, 61 days is not. Later than that the section won't reimburse it
// — the money left someone's own account, and a claim that old can no longer be
// checked against the period it belongs to.
//
// Only "eget utlägg". A sektionskort purchase is already the section's own money
// out of the section's own account; it shows up on the bank statement whether
// anyone accounts for it or not, so a late one still has to be accounted for.
export const REIMBURSEMENT_DEADLINE_DAYS = 60;

export function isLateReimbursement(
  purchaseDate: string,
  paymentType: PaymentType,
): boolean {
  return (
    paymentType === "REIMBURSEMENT" &&
    isCompleteDate(purchaseDate) &&
    daysAgo(purchaseDate) > REIMBURSEMENT_DEADLINE_DAYS
  );
}

type SubmitCandidate = {
  title: string;
  purchaseDate: string;
  grossAmount: number; // SEK — negative for a return
  paymentType: PaymentType;
  matchedTransactionId?: string;
  submitterHasPayout: boolean;
  /** The receipt is the underlag the whole utlägg rests on — see below. */
  receiptId?: string | null;
  allocations: { amount: number; costCenterCode: string }[];
};

// Why an expense can't be sent for attest yet, or null when it's ready: a
// missing bank match (card), a missing payout account (reimbursement), or
// incomplete/unbalanced details. Returning the reason rather than a bare
// boolean keeps the hint text in step with the gate. Mirrors the server-side
// check in the transition route.
export type SubmitBlocker =
  | "match"
  | "payout"
  | "receipt"
  | "incomplete"
  | "futureDate"
  | "tooLate";

export function submitBlocker(e: SubmitCandidate): SubmitBlocker | null {
  // First, ahead of everything the submitter could still fix: past the filing
  // deadline there is nothing to fix, and sending them off to fill in a payout
  // account or upload a receipt for a claim that can't be taken is worse than
  // useless. Safe this early — it wants a whole date and checks for one itself.
  if (isLateReimbursement(e.purchaseDate, e.paymentType)) return "tooLate";
  if (e.paymentType === "CARD" && !e.matchedTransactionId) return "match";
  if (e.paymentType === "REIMBURSEMENT" && !e.submitterHasPayout) return "payout";
  // An utlägg is a claim on the section's money, and the receipt is the only
  // evidence it happened — bokföringslagen wants that underlag kept, and an
  // attester has nothing to attest without it. Named separately from the rest
  // of the missing details because it's the one that can't be typed in.
  if (!e.receiptId) return "receipt";
  // A return is a negative amount, so the amount is only missing when it's zero
  // (or not a number at all) — `!` covers both.
  // A half-typed date ("2026", "2026-07") counts as missing, not as a date:
  // it isn't the day anything was bought.
  if (!e.title.trim() || !isCompleteDate(e.purchaseDate) || !e.grossAmount) return "incomplete";
  // Named apart from "incomplete": the date is there and whole, it's just a day
  // that hasn't come yet, and "fill in the date" would be no help at all.
  if (isFutureDate(e.purchaseDate)) return "futureDate";
  if (e.allocations.length === 0) return "incomplete";
  // Every row has to name a cost centre; the picker starts empty on purpose.
  if (e.allocations.some((a) => !a.costCenterCode.trim())) return "incomplete";
  const sum = e.allocations.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(sum - e.grossAmount) > 0.005) return "incomplete";
  return null;
}

// What to tell the submitter for each blocker lives in messages, under
// `expenses.submitBlocker.<blocker>` — `domain/` stays language-neutral.

// Single source of truth for how each status looks and reads.
// StatusPill and every other surface pull labels/colours from here so
// the visual language stays uniform.

// An expense is editable before it's signed (and not terminal). Used by the
// detail page, the edit page, and the PATCH route.
export const EDITABLE_STATUSES: ExpenseStatus[] = [
  "DRAFT",
  "PENDING_MATCH",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
];

export const isEditable = (status: string): boolean =>
  EDITABLE_STATUSES.includes(status as ExpenseStatus);

// Pre-attest statuses: the owner may still send (or re-send) these for attest.
// Used by the detail page, the new/edit flow, and the transition route.
export const SUBMITTABLE_STATUSES: ExpenseStatus[] = [
  "DRAFT",
  "PENDING_MATCH",
  "CHANGES_REQUESTED",
];

export const isSubmittable = (status: string): boolean => SUBMITTABLE_STATUSES.includes(status as ExpenseStatus);

// "Attested or further" — once here, only an admin may delete the utlägg.
export const SIGNED_STATUSES: ExpenseStatus[] = ["APPROVED", "BOOKED", "EXPORTED"];

export const isSigned = (status: string): boolean => SIGNED_STATUSES.includes(status as ExpenseStatus);

// An attester may pull their own attest back until the utlägg is bokfört —
// after that the voucher exists and only bookkeeping can unwind it.
// Withdrawing from APPROVED drops the utlägg back to PENDING_APPROVAL.
const ATTEST_WITHDRAWABLE_STATUSES: ExpenseStatus[] = ["PENDING_APPROVAL", "APPROVED"];

export const isAttestWithdrawable = (status: string): boolean =>
  ATTEST_WITHDRAWABLE_STATUSES.includes(status as ExpenseStatus);

export const isPendingApproval = (status: string): boolean => status as ExpenseStatus === "PENDING_APPROVAL";

// An utlägg that has left the submitter's hands: waiting for attest, or
// attested and beyond. This is exactly the union the two tabs on the attest
// page show, and so exactly what its "Alla" view means — the whole section's
// attest queue, rather than everything that happens to exist. A DRAFT nobody
// has sent yet is not part of anyone's queue.
export const isInAttestChain = (status: string): boolean =>
  isPendingApproval(status) || isSigned(status);

// Every status, in the order an utlägg passes through them. The status filter on
// the utlägg list offers exactly these, so a new status shows up there by being
// added here rather than by anyone remembering to. Labels are translations
// (`common.status.<STATUS>`), as everywhere else in this file.
export const EXPENSE_STATUSES: readonly ExpenseStatus[] = [
  "DRAFT",
  "PENDING_MATCH",
  "PENDING_APPROVAL",
  "CHANGES_REQUESTED",
  "APPROVED",
  "BOOKED",
  "EXPORTED",
];

type Tone = "neutral" | "purple" | "accent" | "success" | "warning" | "danger";

// How each status reads visually. The label itself is a translation —
// `common.status.<STATUS>` in messages/*.json — so this stays language-neutral.
//
// Six statuses, six meanings, one colour each:
//   neutral  nobody is waiting on anything yet
//   warning  waiting on YOU, the submitter
//   purple   waiting on the authority chain — an attestant has it
//   danger   it came back; something is wrong
//   success  settled
//   accent   the treasury has taken it over
//
// PENDING_APPROVAL is purple rather than the section's pink because pink is the
// primary action everywhere else, and the most common status on the busiest
// screen must not look like a button.
export const STATUS_TONE: Record<ExpenseStatus, Tone> = {
  DRAFT: "neutral",
  PENDING_MATCH: "warning",
  PENDING_APPROVAL: "purple",
  CHANGES_REQUESTED: "danger",
  APPROVED: "success",
  BOOKED: "accent",
  EXPORTED: "success",
};

// Every tone here resolves to a real token. BOOKED used to be a "pink" tone
// pointing at `bg-pink-soft text-pink`, which was never defined anywhere — the
// pill rendered with no fill and inherited text.
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-surface text-muted",
  purple: "bg-purple-soft text-purple",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

// Payment types in the order they're offered. Labels and descriptions live
// under `common.payment.<TYPE>` in messages/*.json.
export const PAYMENT_TYPES: readonly PaymentType[] = ["CARD", "REIMBURSEMENT"];
