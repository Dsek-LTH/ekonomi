import { canAccessBookkeeping, hasAttestRole } from "./permissions";
import type { Expense, Role } from "./types";

// Exactly what deciding a queue needs: who is asking, and what they may do.
// Narrower than `User` on purpose — a pure function that takes the whole record
// invites callers to pass a whole record, and then the next reader cannot tell
// which fields matter. Both `User` and `CurrentUser` satisfy it structurally.
type Viewer = { id: string; roles: Role[] };

// What the dashboard is: one question, "what needs you now", answered for
// whoever is asking.
//
// The old dashboard had a section per role, so a skattmästare who also owners a
// result unit got two of everything and a third role would have added a third
// block. This asks the question per *utlägg* instead: given this viewer, is
// this one waiting on them, and for what? A person with every role in the
// section still gets one list.
//
// Language-neutral, like ExpenseEvent: the action is an enum and the UI renders
// the Swedish. `domain/` stays pure — no database, no formatting, no clock.

export type QueueAction =
  | "FIX" // came back to you with changes requested
  | "SUBMIT" // still a draft; nobody knows about it yet
  | "MATCH" // a card purchase with no bank row against it
  | "ATTEST" // someone else's, and you are the one who may attest it
  | "BOOK" // attested, waiting for a verifikation
  | "EXPORT"; // booked, waiting to go to Fortnox

export interface QueueItem {
  expense: Expense;
  action: QueueAction;
}

// Ordered by whose money is stuck and for how long it has been stuck.
//
// The submitter's own blockers come first: an utlägg that came back, or never
// left, is money the section owes someone that nothing else in the system is
// going to move. Attest is next, because a resultatansvarig is the only person
// who can clear it and they come in specifically to do so. Bookkeeping last —
// it is real work, but it happens in planned sittings rather than in response
// to a notification, and skattmästeriet has its own screens for it.
const URGENCY: Record<QueueAction, number> = {
  FIX: 0,
  SUBMIT: 1,
  MATCH: 2,
  ATTEST: 3,
  BOOK: 4,
  EXPORT: 5,
};

// The one thing this expense needs from this viewer, or null if it is waiting
// on somebody else. An utlägg can only ever be waiting on one person at a time,
// which is why this returns a single action rather than a list.
export function queueActionFor(
  expense: Expense,
  user: Viewer,
): QueueAction | null {
  const mine = expense.submitterId === user.id;

  // The submitter's own court. Checked first: if it is yours and it is stuck,
  // that is the thing you came here to see, whatever else you are in the section.
  if (mine) {
    if (expense.status === "CHANGES_REQUESTED") return "FIX";
    if (expense.status === "DRAFT") return "SUBMIT";
    // A card purchase cannot be sent for attest until it is matched against the
    // bank row — the same gate `submitBlocker` enforces on the detail page.
    if (expense.status === "PENDING_MATCH") return "MATCH";
  }

  // Someone else's, and you hold the ownership over one of its kostnadsställen.
  // `canAttest` is computed per allocation against the viewer, so this never
  // has to re-derive authority — it only has to check it has not been used yet.
  if (
    expense.status === "PENDING_APPROVAL" &&
    hasAttestRole(user.roles) &&
    expense.allocations.some((a) => a.canAttest && !a.approvedById)
  ) {
    return "ATTEST";
  }

  if (canAccessBookkeeping(user.roles)) {
    if (expense.status === "APPROVED") return "BOOK";
    if (expense.status === "BOOKED") return "EXPORT";
  }

  return null;
}

// Everything waiting on this viewer, most urgent first, oldest first inside one
// action. Oldest-first is deliberate: a queue sorted newest-first quietly buries
// the utlägg that has been waiting three weeks, which is the one someone is
// actually annoyed about.
export function buildQueue(expenses: Expense[], user: Viewer): QueueItem[] {
  return expenses
    .flatMap((expense) => {
      const action = queueActionFor(expense, user);
      return action ? [{ expense, action }] : [];
    })
    .sort(
      (a, b) =>
        URGENCY[a.action] - URGENCY[b.action] ||
        a.expense.purchaseDate.localeCompare(b.expense.purchaseDate),
    );
}
