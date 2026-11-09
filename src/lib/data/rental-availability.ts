// Query half of lib/contract/availability.ts, which holds the rule.
import "server-only";

import { prisma } from "@/lib/server/db";
import { freeOver, shortfalls, type Booking, type Shortfall } from "@/lib/contract/availability";
import { isoDay } from "@/lib/domain/date";
/**
 * Every catalogue line held over a period. The caller widens it to whole days (ISO day strings
 * are compared to keep timezones out). `exclude` is the contract being edited.
 */
async function bookingsOver(
  period: { from: string; to: string },
  exclude?: string,
): Promise<Booking[]> {
  const rows = await prisma.rentalLine.findMany({
    where: {
      itemId: { not: null },
      rental: {
        contract: {
          // Every rental holds its gear, drafts included, to stop two contracts for the same day.
          ...(exclude ? { id: { not: exclude } } : {}),
        },
        pickupAt: { lte: new Date(`${period.to}T23:59:59.999Z`) },
        returnAt: { gte: new Date(`${period.from}T00:00:00.000Z`) },
      },
    },
    select: {
      itemId: true,
      quantity: true,
      rental: { select: { pickupAt: true, returnAt: true, returnedAt: true } },
    },
  });

  return rows.map((r) => ({
    itemId: r.itemId!,
    quantity: r.quantity,
    from: isoDay(r.rental.pickupAt),
    // Returned gear is free again from the day it came back, whatever the contract said.
    to: isoDay(r.rental.returnedAt ?? r.rental.returnAt),
  }));
}

async function ownedCounts(): Promise<Map<string, number>> {
  const items = await prisma.rentalItem.findMany({
    select: { id: true, quantity: true },
  });
  return new Map(items.map((i) => [i.id, i.quantity]));
}

export interface Availability {
  itemId: string;
  owned: number;
  free: number;
}

export async function getAvailability(
  period: { from: string; to: string },
  exclude?: string,
): Promise<Availability[]> {
  const [owned, bookings] = await Promise.all([ownedCounts(), bookingsOver(period, exclude)]);
  const free = freeOver({ owned, bookings, period });
  return [...owned].map(([itemId, count]) => ({
    itemId,
    owned: count,
    free: free.get(itemId) ?? count,
  }));
}

export async function checkAvailability(args: {
  // Optional as well as nullable: matches the request schema, called straight from the parsed body.
  lines: readonly { itemId?: string | null; quantity: number }[];
  period: { from: string; to: string };
  exclude?: string;
}): Promise<Shortfall[]> {
  const requests = args.lines
    .filter((l): l is { itemId: string; quantity: number } => Boolean(l.itemId))
    .map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
  if (requests.length === 0) return [];

  const [owned, bookings] = await Promise.all([
    ownedCounts(),
    bookingsOver(args.period, args.exclude),
  ]);
  return shortfalls({ requests, owned, bookings, period: args.period });
}

export async function nameShortfalls(
  found: readonly Shortfall[],
): Promise<{ name: string; owned: number; booked: number; wanted: number }[]> {
  if (found.length === 0) return [];
  const items = await prisma.rentalItem.findMany({
    where: { id: { in: found.map((s) => s.itemId) } },
    select: { id: true, name: true },
  });
  const names = new Map(items.map((i) => [i.id, i.name]));
  return found.map((s) => ({
    name: names.get(s.itemId) ?? s.itemId,
    owned: s.owned,
    booked: s.booked,
    wanted: s.wanted,
  }));
}
