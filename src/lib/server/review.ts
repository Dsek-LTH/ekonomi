// The two-person rule's inputs, read from the database. The rule itself is in
// lib/domain/review.ts. It always holds; who is exempt is a capability.
import "server-only";

import { prisma } from "@/lib/server/db";
import { canReviewOwnBooking } from "@/lib/domain/permissions";
import { bookedBy, bookingTrail, reviewBlocker } from "@/lib/domain/review";
import type { Capability } from "@/lib/domain/types";

/** Who wrote each utlägg's kontering, by expense id. See `bookedBy`. */
export async function bookedByOf(expenseIds: readonly string[]): Promise<Map<string, string[]>> {
  const events = await prisma.expenseEvent.findMany({
    where: { expenseId: { in: [...expenseIds] }, type: { in: ["BOOKED", "EDITED"] } },
    orderBy: { createdAt: "asc" },
    select: { expenseId: true, type: true, actorId: true },
  });
  const byExpense = new Map<string, { type: string; actorId: string | null }[]>();
  for (const e of events) {
    const list = byExpense.get(e.expenseId) ?? [];
    list.push(e);
    byExpense.set(e.expenseId, list);
  }
  return new Map(expenseIds.map((id) => [id, bookedBy(byExpense.get(id) ?? [])]));
}

/** Why this person may not bokföra this utlägg, or null. */
export async function exportReviewBlocker(
  expenseId: string,
  viewer: { id: string; capabilities: readonly Capability[] },
): Promise<"ownBooking" | null> {
  const exempt = canReviewOwnBooking(viewer.capabilities);
  if (exempt) return null;
  const by = await bookedByOf([expenseId]);
  return reviewBlocker({
    exempt,
    viewerId: viewer.id,
    bookedBy: by.get(expenseId) ?? [],
  });
}

/** Who konterade one utlägg and when, and who amended it since, by name. */
export interface BookingNames {
  by: string;
  at: Date;
  /** Everyone but `by`, in the order they first amended it. */
  amendedBy: string[];
}

/**
 * The kontering's people, by name, for the cover page filed with the voucher.
 * See `bookingTrail`.
 */
export async function bookingNamesOf(expenseId: string): Promise<BookingNames | null> {
  const events = await prisma.expenseEvent.findMany({
    where: { expenseId, type: { in: ["BOOKED", "EDITED"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { type: true, createdAt: true, actor: { select: { name: true } } },
  });
  const trail = bookingTrail(events);
  if (!trail) return null;
  const by = trail.booked.actor?.name ?? "System";
  const amendedBy = trail.amended.flatMap((e) => (e.actor ? [e.actor.name] : []));
  return {
    by,
    at: trail.booked.createdAt,
    amendedBy: [...new Set(amendedBy)].filter((n) => n !== by),
  };
}
