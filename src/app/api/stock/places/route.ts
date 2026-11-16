// A stock's places: where stock is carried to and whose cost centre it is charged to. Kept in Inställningar -> Lager.
// See StockPlace in stock.prisma and docs/stock.md, section 11.

import { NextResponse } from "next/server";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockPlace } from "@/lib/api/schemas/stock";
import { canAccessSettings } from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { isCollision } from "@/lib/server/stock-product-guard";
import { STOCKS } from "@/lib/stock/stocks";

export async function POST(req: Request) {
  const g = await gate(canAccessSettings, "auth.adminOnly");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockPlace);
  if (!parsed.ok) return parsed.res;
  const { stock, name } = parsed.data;
  if (!STOCKS[stock].usesPlaces) return fail(422, "stock.kindNotHere");

  const last = await prisma.stockPlace.aggregate({
    where: { stockId: stock },
    _max: { sortOrder: true },
  });
  const made = await prisma.stockPlace
    .create({
      data: { stockId: stock, name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      select: { id: true },
    })
    .catch((err: unknown) => {
      if (isCollision(err)) return null;
      throw err;
    });
  if (!made) return fail(409, "stock.placeNameTaken");
  return NextResponse.json({ id: made.id }, { status: 201 });
}
