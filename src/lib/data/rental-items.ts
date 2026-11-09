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

export interface RentalItemOption {
  id: string;
  name: string;
  dailyPriceOre: number | null;
  replacementValueOre: number;
  quantity: number;
}

// Name order: `sortOrder` exists for hand-arranged lists, which this is not yet.
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
