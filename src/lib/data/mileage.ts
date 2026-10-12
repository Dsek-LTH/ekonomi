// The mileage rate table, as the settings screen reads it.
//
// Apart from lib/mileage/store.ts, which serves the *calculation*. That one
// answers "what is a kilometre worth on this day" and carries nothing it does
// not need for it. This one is a list to look at: who entered a rate and what
// they wrote against it, which no claim ever asks about.
import "server-only";

import { prisma } from "@/lib/server/db";

export interface MileageRateRow {
  id: string;
  orePerKm: number;
  /** ISO date. */
  validFrom: string;
  note?: string;
  createdBy?: string;
}

/** Every rate, newest first: the order the table is read in, since the top
 *  row is the one in force. */
export async function getMileageRateRows(): Promise<MileageRateRow[]> {
  const rows = await prisma.mileageRate.findMany({
    orderBy: { validFrom: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orePerKm: r.orePerKm,
    validFrom: r.validFrom.toISOString().slice(0, 10),
    note: r.note ?? undefined,
    createdBy: r.createdBy?.name ?? undefined,
  }));
}
