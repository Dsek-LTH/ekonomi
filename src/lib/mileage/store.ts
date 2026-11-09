// The database half of a milersättning (claim.ts is pure and shared with the browser).
import "server-only";

import { prisma } from "@/lib/server/db";
import { valueJourney, type JourneyInput } from "./claim";
import type { MileageRateLike } from "./rate";
import { isoDay } from "@/lib/domain/date";

/** Every rate ever recorded, newest first: a journey is valued at the rate of the day it was driven. */
export async function getMileageRates(): Promise<MileageRateLike[]> {
  const rows = await prisma.mileageRate.findMany({
    orderBy: { validFrom: "desc" },
    select: { orePerKm: true, validFrom: true },
  });
  return rows.map((r) => ({ orePerKm: r.orePerKm, validFrom: isoDay(r.validFrom) }));
}

/**
 * Value a journey against the rate table before saving. Returns the rate too, so the amount stays checkable after the
 * schablon moves. An unvaluable journey comes back with nulls, which `claimBlocker` refuses to send.
 */
export async function valueForStorage(
  journey: Pick<JourneyInput, "date" | "odometerStart" | "odometerEnd">,
): Promise<{ grossAmount: number | null; orePerKm: number | null }> {
  const valued = valueJourney(journey, await getMileageRates());
  return { grossAmount: valued.ore, orePerKm: valued.orePerKm };
}
