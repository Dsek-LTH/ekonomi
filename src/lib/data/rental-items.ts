// The gear catalogue, as the settings screen and the rental form read it.
//
// Two callers with two different needs, so two functions rather than one with a
// flag. The settings screen wants a count of how many contracts point at each
// item, so the dialog can say where it is used. The rental form only picks
// from the list, and has no use for the counts.
import "server-only";

import { prisma } from "@/lib/server/db";

export interface RentalItemRow {
  id: string;
  name: string;
  description: string | null;
  /** Öre, or null for an item priced case by case. */
  dailyPriceOre: number | null;
  replacementValueOre: number;
  /** How many the section owns. What availability is measured against. */
  quantity: number;
  /** Contract lines pointing at this item. Drives whether it can be deleted. */
  usedBy: number;
}

/** What the rental form picks from: one option per item still on offer. */
export interface RentalItemOption {
  id: string;
  name: string;
  dailyPriceOre: number | null;
  replacementValueOre: number;
  quantity: number;
}

// Name order, not insertion order. A catalogue is read by looking for a thing
// you already have in mind, and `sortOrder` exists for a list somebody has
// arranged deliberately, which this is not yet. It is on the model so that it
// can become one without a migration.
const BY_NAME = [{ sortOrder: "asc" as const }, { name: "asc" as const }];

export async function getRentalItemRows(): Promise<RentalItemRow[]> {
  const rows = await prisma.rentalItem.findMany({
    orderBy: BY_NAME,
    include: { _count: { select: { lines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    dailyPriceOre: r.dailyPriceOre,
    replacementValueOre: r.replacementValueOre,
    quantity: r.quantity,
    usedBy: r._count.lines,
  }));
}

export async function getRentalItemOptions(): Promise<RentalItemOption[]> {
  const rows = await prisma.rentalItem.findMany({
    orderBy: BY_NAME,
    select: {
      id: true,
      name: true,
      dailyPriceOre: true,
      replacementValueOre: true,
      quantity: true,
    },
  });
  return rows;
}
