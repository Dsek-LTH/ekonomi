// Reads every product's log forward again and writes back what it should hold, for when the rules
// changed or rows predate a rule. Safe as a button: a row that carries a cost
// (StockEntry.unitCostOre) keeps it. A row written before the product had a price gets today's.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gateStock } from "@/lib/api/stock-gate";
import { priceUnpricedRows, replayProduct } from "@/lib/server/stock-replay";

export async function POST(req: Request) {
  const g = await gateStock(new URL(req.url).searchParams.get("stock"), "manage");
  if (!g.ok) return g.res;

  const products = await prisma.stockProduct.findMany({
    where: { stockId: g.stock },
    select: { id: true, costPriceOre: true },
  });

  // The shelf's value before and after, summed over the whole table.
  const total = async () =>
    (
      await prisma.stockEntry.aggregate({
        where: { product: { stockId: g.stock } },
        _sum: { valueDeltaOre: true },
      })
    )._sum.valueDeltaOre ?? 0;
  const beforeOre = await total();

  // A transaction per product: one over the whole shelf would hold locks while a cellar is stocked.
  let rows = 0;
  let touched = 0;
  for (const p of products) {
    const written = await prisma.$transaction(async (tx) => {
      const priced = await priceUnpricedRows(tx, p.id, p.costPriceOre);
      return priced + (await replayProduct(tx, p.id));
    });
    if (written > 0) {
      rows += written;
      touched++;
    }
  }

  return NextResponse.json({ products: touched, rows, beforeOre, afterOre: await total() });
}
