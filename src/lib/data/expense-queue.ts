// The next utlägg in the two queues somebody works through one after another:
// the attest queue and the bookkeeping queue.
//
// The detail page asks, so that attesting or booking one can be followed by
// the next without going back to the list in between. Each queue is the same
// rows its nav count counts (see nav-counts.ts), in the order its list shows
// them, so "next" is the row that would be next on the screen you came from.
import "server-only";

import { prisma } from "@/lib/server/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canAccessBookkeeping, hasAttestRole } from "@/lib/domain/permissions";
import { attestScopeWhere } from "./attest-scope";
import type { Viewer } from "./expense-scope";

export type ExpenseQueue = "approvals" | "bookkeeping";

export interface QueueNext {
  /** The next one waiting, or null when the queue is empty but for this one. */
  next: { id: string; title: string; reference: string | null } | null;
  /** How many are waiting, not counting the utlägg being looked at. */
  remaining: number;
}

/** The queues this viewer works, each without the utlägg they are on. */
export async function getExpenseQueues(
  viewer: Viewer,
  currentId: string,
): Promise<Partial<Record<ExpenseQueue, QueueNext>>> {
  const [approvals, bookkeeping] = await Promise.all([
    hasAttestRole(viewer.capabilities)
      ? attestScopeWhere(viewer).then((scope) =>
          nextIn({ AND: [scope, { status: "PENDING_APPROVAL" }] }, currentId),
        )
      : null,
    // Booking, not exporting: an attested utlägg is booked one at a time,
    // while the booked ones go to Fortnox together from the list.
    canAccessBookkeeping(viewer.capabilities)
      ? nextIn({ status: "APPROVED" }, currentId)
      : null,
  ]);
  return {
    ...(approvals && { approvals }),
    ...(bookkeeping && { bookkeeping }),
  };
}

async function nextIn(queue: Prisma.ExpenseWhereInput, currentId: string): Promise<QueueNext> {
  const where: Prisma.ExpenseWhereInput = { AND: [queue, { id: { not: currentId } }] };
  const [next, remaining] = await Promise.all([
    prisma.expense.findFirst({
      where,
      // The lists' own default order (lib/data/expenses.ts).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, reference: true },
    }),
    prisma.expense.count({ where }),
  ]);
  return { next, remaining };
}
