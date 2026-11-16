// The board's price list: what a product costs a board member, from a day on. A new price is a new row, so the
// list is its own history, and a price never changes what has already been taken.

import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { SetBoardPrice } from "@/lib/api/schemas/board";
import { BOARD_STOCK } from "@/lib/data/board";
import { canBookkeep } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";

export async function POST(req: Request) {
  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, SetBoardPrice);
  if (!parsed.ok) return parsed.res;
  const { productId, priceOre, validFrom } = parsed.data;

  const product = await prisma.stockProduct.findUnique({
    where: { id: productId },
    select: { stockId: true },
  });
  if (!product || product.stockId !== BOARD_STOCK) return fail(404, "stock.productNotFound");

  const day = new Date(validFrom);
  // Typed again for the same day: the figure for that day is corrected, not doubled.
  const price = await prisma.boardPrice.upsert({
    where: { productId_validFrom: { productId, validFrom: day } },
    create: { productId, priceOre, validFrom: day, createdById: g.actor.id },
    update: { priceOre, createdById: g.actor.id },
    select: { id: true },
  });
  return NextResponse.json({ id: price.id }, { status: 201 });
}
