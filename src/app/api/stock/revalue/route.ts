// Read every product's log forward again and write back what it should hold.
//
// The app replays a product after every write to it, so the stored figures are
// normally already the ones the rules produce. What that does not cover is the
// rules themselves changing, or rows written before a rule existed: an arrival
// onto an empty shelf used to be worth nothing, which valued a cellar entered
// with the stocktake button at zero and left it there.
//
// It cannot re-price anything. Every row carries the cost it was booked at
// (StockEntry.unitCostOre), so this reproduces exactly what the rules already
// imply and a product re-priced yesterday is not touched by it. That is what
// makes it safe to offer as a button rather than as a script somebody has to be
// trusted with. See lib/stock/value.ts.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { canManageStock } from "@/lib/domain/permissions";
import { replayProduct } from "@/lib/server/stock-replay";

export async function POST() {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const products = await prisma.stockProduct.findMany({ select: { id: true } });

  // What the shelf is worth, before and after. Summed over the whole table
  // rather than per product: it is one figure on one screen, and what the
  // person pressing this wants to know is whether it moved.
  const total = async () =>
    (await prisma.stockEntry.aggregate({ _sum: { valueDeltaOre: true } }))._sum.valueDeltaOre ?? 0;
  const beforeOre = await total();

  // A transaction per product, not one around the lot. A product's log is
  // consistent on its own and the work is bounded by it; one transaction over
  // the whole shelf would hold locks across the table while a cellar is being
  // stocked.
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
