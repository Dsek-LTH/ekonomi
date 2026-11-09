// Reads every product's log forward again and writes back what it should hold, for when the rules
// changed or rows predate a rule. Safe as a button: each row carries its own cost
// (StockEntry.unitCostOre), so nothing is re-priced.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { canManageStock } from "@/lib/domain/permissions";
import { replayProduct } from "@/lib/server/stock-replay";

export async function POST() {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const products = await prisma.stockProduct.findMany({ select: { id: true } });

  // The shelf's value before and after, summed over the whole table.
  const total = async () =>
    (await prisma.stockEntry.aggregate({ _sum: { valueDeltaOre: true } }))._sum.valueDeltaOre ?? 0;
  const beforeOre = await total();

  // A transaction per product: one over the whole shelf would hold locks while a cellar is stocked.
  let rows = 0;
  let touched = 0;
  for (const p of products) {
    const written = await prisma.$transaction((tx) => replayProduct(tx, p.id));
    if (written > 0) {
      rows += written;
      touched++;
    }
  }

  return NextResponse.json({ products: touched, rows, beforeOre, afterOre: await total() });
}
