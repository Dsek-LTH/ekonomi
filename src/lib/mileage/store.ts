// The database half of a milersättning: reading the rate table, and valuing a
// journey against it.
//
// Kept apart from claim.ts, which is pure and shared with the browser. This is
// the file that knows about Prisma; everything it decides, it decides by asking
// that one.
import "server-only";

import { prisma } from "@/lib/server/db";
import { valueJourney, type JourneyInput } from "./claim";
import type { MileageRateLike } from "./rate";

/** ISO date out of a `@db.Date` column, with no timezone in the way. */
const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Every rate ever recorded, newest first.
 *
 * All of them rather than the one in force today: a journey is valued at the
 * rate that applied on the day it was driven, and one filed in January may have
 * been driven in December. The table has one row a year, so "all of them" is a
 * handful.
 */
export async function getMileageRates(): Promise<MileageRateLike[]> {
  const rows = await prisma.mileageRate.findMany({
    orderBy: { validFrom: "desc" },
    select: { orePerKm: true, validFrom: true },
  });
  return rows.map((r) => ({ orePerKm: r.orePerKm, validFrom: iso(r.validFrom) }));
}

/**
 * Value a journey against the rate table, for a save that is about to store it.
 *
 * Returns the rate as well as the amount, because both go onto the utlägg: the
 * amount is what is claimed, and the rate is what makes that amount checkable a
 * year later when the schablon has moved. A journey that cannot be valued (a
 * day no rate covers, readings that do not go forward) comes back with nulls,
 * and `claimBlocker` is what refuses to send it.
 */
export async function valueForStorage(
  journey: JourneyInput,
): Promise<{ grossAmount: number | null; orePerKm: number | null }> {
  const valued = valueJourney(journey, await getMileageRates());
  return { grossAmount: valued.ore, orePerKm: valued.orePerKm };
}
