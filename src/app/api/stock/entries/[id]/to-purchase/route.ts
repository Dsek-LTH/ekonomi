// A stocktake that should have been a delivery, made one.
//
// Bottles bought in and booked as a stocktake that "found" them come onto the
// shelf at the shelf's average, which on an unvalued shelf is nothing, and
// never reach the restaurangrapport's bought-in volume, since only a purchase
// does. This puts that right without rewriting what was recorded: a purchase
// of what the count found, on the same day, priced from the product, ordered
// just before the count. Replayed, the count then agrees with the log, stays
// as the evidence that somebody counted, and the bottles carry what they cost.
//
// POST /api/stock/entries/:id/to-purchase, where :id is any row of the day's
// stocktake of the product (the cellar list shows a day's count as one row).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { canManageStock } from "@/lib/domain/permissions";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";

/** What the new purchase says about itself in the log. */
const NOTE = "Inköp, omgjort från inventering";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;
  const { id } = await params;

  const entry = await prisma.stockEntry.findUnique({
    where: { id },
    select: { productId: true, kind: true, occurredAt: true },
  });
  if (!entry) return fail(404, "stock.entryNotFound");
  if (entry.kind !== "COUNT") return fail(422, "stock.onlyStocktake");

  const product = await prisma.stockProduct.findUnique({
    where: { id: entry.productId },
    select: { id: true, costPriceOre: true },
  });
  if (!product) return fail(404, "stock.productNotFound");
  // A purchase is booked at what the product costs. Without a price it would
  // come in at nothing, which is the very thing being put right.
  if (product.costPriceOre == null) return fail(422, "stock.costRequired");

  // The day's count: one row per rung. Only the sealed one can be a delivery,
  // since a purchase arrives sealed, and only what it found more of.
  const day = await prisma.stockEntry.findMany({
    where: { productId: product.id, kind: "COUNT", occurredAt: entry.occurredAt },
    select: { level: true, units: true, createdAt: true },
  });
  const found = day.filter((r) => r.level === 0).reduce((n, r) => n + r.units, 0);
  if (found <= 0) return fail(422, "stock.stocktakeFoundNothing");
  const first = day.reduce((t, r) => (r.createdAt < t ? r.createdAt : t), day[0].createdAt);

  const made = await bulkTransaction(async (tx) => {
    const purchase = await tx.stockEntry.create({
      data: {
        productId: product.id,
        kind: "PURCHASE",
        units: found,
        unitCostOre: product.costPriceOre,
        occurredAt: entry.occurredAt,
        // A moment before the count, so the log reads it first: the bottles
        // arrive, and then the count finds what the books now expect.
        createdAt: new Date(first.getTime() - 1),
        actorId: g.actor.id,
        note: NOTE,
      },
      select: { id: true },
    });
    await tx.stockChange.create({
      data: {
        entryId: purchase.id,
        productId: product.id,
        action: "CREATE",
        kind: "PURCHASE",
        level: 0,
        toQty: found,
        actorId: g.actor.id,
      },
    });
    await replayProduct(tx, product.id);
    return purchase.id;
  });

  return NextResponse.json({ id: made, units: found }, { status: 201 });
}
