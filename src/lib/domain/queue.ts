import { canBookkeep, hasAttestRole } from "./permissions";
import type { Capability, Expense, Role } from "./types";

// Exactly what deciding a queue needs: who is asking, and what they may do. `User` and `CurrentUser` both satisfy it.
type Viewer = { id: string; roles: Role[]; capabilities: Capability[] };

// "What needs you now", answered per utlägg for the viewer (not a section per role, which doubled up
// for people with several roles). Language-neutral: the action is an enum and the UI renders the Swedish.

export type QueueAction =
  | "FIX" // came back to you with changes requested
  | "SUBMIT" // still a draft; nobody knows about it yet
  | "ATTEST" // someone else's, and you are the one who may attest it
  | "BOOK" // attested, waiting for a verifikation
  | "EXPORT"; // booked, waiting to go to Fortnox

export interface QueueItem {
  expense: Expense;
  action: QueueAction;
}

// Ordered by whose money is stuck: the submitter's own blockers first, then attest (only the
// resultatansvarig can clear it), then bookkeeping, which happens in planned sittings.
const URGENCY: Record<QueueAction, number> = {
  FIX: 0,
  SUBMIT: 1,
  ATTEST: 2,
  BOOK: 3,
  EXPORT: 4,
};

// The one thing this expense needs from this viewer, or null. An utlägg waits on one person at a time.
export function queueActionFor(expense: Expense, user: Viewer): QueueAction | null {
  const mine = expense.submitterId === user.id;

  // The submitter's own court, checked first.
  if (mine) {
    if (expense.status === "CHANGES_REQUESTED") return "FIX";
    if (expense.status === "DRAFT") return "SUBMIT";
  }

  // Someone else's, and you hold ownership over one of its kostnadsställen. `canAttest` is computed per
  // allocation, so only check it has not been used yet.
  if (
    expense.status === "PENDING_APPROVAL" &&
    hasAttestRole(user.capabilities) &&
    expense.allocations.some((a) => a.canAttest && !a.approvedById)
  ) {
    return "ATTEST";
  }

  if (canBookkeep(user.capabilities)) {
    if (expense.status === "APPROVED") return "BOOK";
    if (expense.status === "BOOKED") return "EXPORT";
  }

  return null;
}

// Everything waiting on this viewer, most urgent first, oldest first inside one action (newest first
// would bury the utlägg waiting three weeks).
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
