// What the gear is already promised to, over a period.
//
// The query half of lib/contract/availability.ts, which holds the rule. Split
// that way because the rule is arithmetic worth asserting on (four stands, two
// contracts, one left) and the query is a join worth keeping out of it.
import "server-only";

import { prisma } from "@/lib/server/db";
import { freeOver, shortfalls, type Booking, type Shortfall } from "@/lib/contract/availability";
import type { ContractStatus } from "@/lib/domain/types";

/**
 * Contract states that hold gear.
 *
 * A draft counts. That is the point of counting at all: the clash to prevent is
 * two people drawing contracts for the same Saturday, and by the time both are
 * signed it is too late to prevent anything. A terminated or cancelled contract
 * releases what it held, which is most of what those states are for.
 */
const HOLDING: ContractStatus[] = ["DRAFT", "OUT_FOR_SIGNATURE", "SIGNED"];

/**
 * Every catalogue line held over a period, as bookings the rule can read.
 *
 * The period is widened to whole days at both ends by the caller: these are
 * `@db.Date`-shaped questions asked of `DateTime` columns, and comparing the
 * ISO day strings is what keeps a timezone out of it.
 *
 * `exclude` is the contract being edited. Without it, amending a rental would
 * find its own lines and report the gear as taken by itself.
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
          status: { in: HOLDING },
          ...(exclude ? { id: { not: exclude } } : {}),
        },
        // Cheap pre-filter in Postgres. The exact overlap, including the early
        // return below, is settled in the rule.
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
    from: day(r.rental.pickupAt),
    // Gear that has already come back is free again from the day it came back,
    // whatever the contract said. An early return that kept the slot booked
    // would have the app refusing to lend out a Soundboks that is sitting on
    // the shelf.
    to: day(r.rental.returnedAt ?? r.rental.returnAt),
  }));
}

/** How many of each catalogue item the section owns and can still let out. */
async function ownedActive(): Promise<Map<string, number>> {
  const items = await prisma.rentalItem.findMany({
    where: { active: true },
    select: { id: true, quantity: true },
  });
  return new Map(items.map((i) => [i.id, i.quantity]));
}

/** One catalogue item, and how much of it is free over the asked-for period. */
export interface Availability {
  itemId: string;
  owned: number;
  free: number;
}

/** What the rental form draws beside each option. */
export async function getAvailability(
  period: { from: string; to: string },
  exclude?: string,
): Promise<Availability[]> {
  const [owned, bookings] = await Promise.all([ownedActive(), bookingsOver(period, exclude)]);
  const free = freeOver({ owned, bookings, period });
  return [...owned].map(([itemId, count]) => ({
    itemId,
    owned: count,
    free: free.get(itemId) ?? count,
  }));
}

/**
 * Whether a contract's lines can be covered over its period.
 *
 * What the create and amend routes call before writing. Returns the items that
 * cannot be, so a refusal can name them rather than saying "something is
 * booked".
 */
export async function checkAvailability(args: {
  // `itemId` is optional as well as nullable, because that is how the request
  // schema spells "this line is free text" and this is called straight from
  // the parsed body.
  lines: readonly { itemId?: string | null; quantity: number }[];
  period: { from: string; to: string };
  exclude?: string;
}): Promise<Shortfall[]> {
  const requests = args.lines
    .filter((l): l is { itemId: string; quantity: number } => Boolean(l.itemId))
    .map((l) => ({ itemId: l.itemId, quantity: l.quantity }));
  if (requests.length === 0) return [];

  const [owned, bookings] = await Promise.all([
    ownedActive(),
    bookingsOver(args.period, args.exclude),
  ]);
  return shortfalls({ requests, owned, bookings, period: args.period });
}

/** The names behind a shortfall, so a refusal can say "Soundboks" rather than
 *  a cuid. */
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

const day = (d: Date): string => d.toISOString().slice(0, 10);
