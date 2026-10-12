// Who a reminder goes to, and which things can be reminded about at all.
//
// Two kinds of thing wait on somebody. An utlägg waits on whoever its status
// says: waiting for attest, the attesters who have not signed yet (which ones
// is the server's to work out, see lib/server/reminders.ts); unsent or sent
// back, the submitter; signed, the treasury, and a reminder would be the
// treasury reminding itself. A card transaction with no utlägg against it
// waits on whoever holds the card.
import { isSubmittable } from "./status";
import type { ExpenseStatus } from "./types";

/** How many things one reminder may cover. More than a list page shows at
 *  once, and few enough to stop a runaway request. */
export const MAX_REMINDER_ITEMS = 100;

export type ReminderTarget = "attesters" | "submitter" | "cardHolder";

/** What a reminder is about: an utlägg, or a card transaction. */
export type ReminderSubject = "expense" | "transaction";

/** Who a reminder about the picked things would reach, as GET /api/reminders
 *  answers. */
export interface ReminderPreview {
  items: {
    id: string;
    subject: ReminderSubject;
    label: string;
    target: ReminderTarget;
    recipients: { id: string; name: string }[];
  }[];
  /** Picked, and not reminded about: not waiting on anybody (signed, or
   *  already accounted for), or nobody left to ask. */
  skipped: { id: string; label: string; reason: "notRemindable" | "nobody" }[];
}

export function reminderTarget(status: ExpenseStatus): ReminderTarget | null {
  if (status === "PENDING_APPROVAL") return "attesters";
  if (isSubmittable(status)) return "submitter";
  return null;
}

/**
 * Whether a list should offer a box to remind about this utlägg, as `viewerId`
 * sees it. Waiting on somebody, and not only on the viewer: a draft of their
 * own is theirs to send. The same rule the utlägg's own page offers the action
 * on (see expenseCapabilities).
 */
export function canRemindAboutExpense(
  e: { status: ExpenseStatus; submitterId: string },
  viewerId: string,
): boolean {
  const target = reminderTarget(e.status);
  return target !== null && !(target === "submitter" && e.submitterId === viewerId);
}

/**
 * Whether a list should offer a box to remind about this card transaction:
 * nothing accounts for it yet, and it sits on somebody else's card.
 */
export function canRemindAboutTransaction(
  t: { matchedExpenseId?: string; cardHolderId?: string },
  viewerId: string,
): boolean {
  return !t.matchedExpenseId && !!t.cardHolderId && t.cardHolderId !== viewerId;
}
