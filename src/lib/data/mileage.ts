import "server-only";

import { prisma } from "@/lib/server/db";
import { isoDay } from "@/lib/domain/date";

export interface MileageRateRow {
  id: string;
  orePerKm: number;
  validFrom: string;
  note?: string;
  createdBy?: string;
}

/** Every rate, newest first (the top row is in force). */
export async function getMileageRateRows(): Promise<MileageRateRow[]> {
  const rows = await prisma.mileageRate.findMany({
    orderBy: { validFrom: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    orePerKm: r.orePerKm,
    validFrom: isoDay(r.validFrom),
    note: r.note ?? undefined,
    createdBy: r.createdBy?.name ?? undefined,
  }));
}
