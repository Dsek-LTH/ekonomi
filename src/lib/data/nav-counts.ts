// How much is waiting behind each link in the nav, for the small count beside
// it. The dashboard's queue (lib/domain/queue.ts) says the same thing about the
// same rows; this is only the number, and only counted, because the layout
// asks for it on every page and the rows themselves are not needed there.
import "server-only";

import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping, hasAttestRole } from "@/lib/domain/permissions";
import { attestScopeWhere } from "./attest-scope";
import { countUnaccountedPurchases } from "./bank";
import type { Viewer } from "./expense-scope";

export interface NavCounts {
  /** The viewer's own utlägg sent back to them to fix. */
  expenses: number;
  /** Their own card purchases with no utlägg yet. */
  bank: number;
  /** Utlägg waiting for their attest. */
  approvals: number;
  /** Attested or booked, waiting on the treasury. */
  bookkeeping: number;
}

export async function getNavCounts(viewer: Viewer): Promise<NavCounts> {
  const [expenses, bank, approvals, bookkeeping] = await Promise.all([
    // Only what came back, not the drafts: a draft is somewhere the member
    // left off on purpose, and a count that never goes away is one nobody
    // reads.
    prisma.expense.count({ where: { submitterId: viewer.id, status: "CHANGES_REQUESTED" } }),
    countUnaccountedPurchases(viewer.id),
    hasAttestRole(viewer.capabilities)
      ? attestScopeWhere(viewer).then((scope) =>
          prisma.expense.count({ where: { AND: [scope, { status: "PENDING_APPROVAL" }] } }),
        )
      : 0,
    canAccessBookkeeping(viewer.capabilities)
      ? prisma.expense.count({ where: { status: { in: ["APPROVED", "BOOKED"] } } })
      : 0,
  ]);
  return { expenses, bank, approvals, bookkeeping };
}
