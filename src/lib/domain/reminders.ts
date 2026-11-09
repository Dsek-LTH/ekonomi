// Who a reminder goes to. An utlägg waits on whoever its status says (attesters not yet signed, see
// lib/server/reminders.ts; the submitter if unsent or sent back; signed means the treasury, so no reminder).
// A card transaction with no utlägg waits on the card holder.
import { isSubmittable } from "./status";
import type { ExpenseStatus } from "./types";

/** How many things one reminder may cover: more than a list page shows, few enough to stop a runaway request. */
export const MAX_REMINDER_ITEMS = 100;

export type ReminderTarget = "attesters" | "submitter" | "cardHolder";

export type ReminderSubject = "expense" | "transaction";

/** Who a reminder about the picked things would reach, as GET /api/reminders answers. */
export interface ReminderPreview {
  items: {
    id: string;
    subject: ReminderSubject;
    label: string;
    target: ReminderTarget;
    recipients: { id: string; name: string }[];
  }[];
  /** Picked, and not reminded about: not waiting on anybody, or nobody left to ask. */
  skipped: { id: string; label: string; reason: "notRemindable" | "nobody" }[];
}

export function reminderTarget(status: ExpenseStatus): ReminderTarget | null {
  if (status === "PENDING_APPROVAL") return "attesters";
  if (isSubmittable(status)) return "submitter";
  return null;
}

/** Whether a list should offer a box to remind about this utlägg: waiting on somebody other than the viewer (same rule as expenseCapabilities). */
export function canRemindAboutExpense(
  e: { status: ExpenseStatus; submitterId: string },
  viewerId: string,
): boolean {
  const target = reminderTarget(e.status);
  return target !== null && !(target === "submitter" && e.submitterId === viewerId);
}

/** Whether a list should offer a box to remind about this card transaction: unaccounted for and on somebody else's card. */
export function canRemindAboutTransaction(
  t: { matchedExpenseId?: string; cardHolderId?: string },
  viewerId: string,
): boolean {
  return !t.matchedExpenseId && !!t.cardHolderId && t.cardHolderId !== viewerId;
}
