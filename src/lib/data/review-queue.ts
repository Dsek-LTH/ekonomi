// The review queue: konterade utlägg waiting to be bokförda, as one viewer may
// work through them.
import "server-only";

import { prisma } from "@/lib/server/db";
import { canReviewOwnBooking } from "@/lib/domain/permissions";
import { reviewBlocker } from "@/lib/domain/review";
import { bookedByOf } from "@/lib/server/review";
import type { During } from "@/lib/server/fiscal-year";
import type { Capability } from "@/lib/domain/types";

export interface ReviewQueue {
  /** What this viewer may bokföra, oldest kontering first. */
  ids: string[];
  /** Konterade by this viewer, so waiting on somebody else. */
  waitingOnOthers: number;
  /** Which those are, so the list can show them as not this viewer's to
   *  bokföra rather than leave them looking like any other. */
  ownIds: string[];
}

export async function getReviewQueue(
  viewer: {
    id: string;
    capabilities: readonly Capability[];
  },
  /** The räkenskapsår, by purchase date, as the Utlägg list it is reached
   *  from. See docs/navigation.md. */
  { during }: { during?: During } = {},
): Promise<ReviewQueue> {
  const booked = await prisma.expense.findMany({
    where: { status: "BOOKED", ...(during ? { purchaseDate: during } : {}) },
    // The order they were konterade in, so the queue is worked oldest first.
    orderBy: [{ verification: { createdAt: "asc" } }, { id: "asc" }],
    select: { id: true },
  });
  const ids = booked.map((e) => e.id);
  const by = await bookedByOf(ids);
  const exempt = canReviewOwnBooking(viewer.capabilities);

  const mine = ids.filter(
    (id) =>
      reviewBlocker({ exempt, viewerId: viewer.id, bookedBy: by.get(id) ?? [] }) !== null,
  );
  return {
    ids: ids.filter((id) => !mine.includes(id)),
    waitingOnOthers: mine.length,
    ownIds: mine,
  };
}
