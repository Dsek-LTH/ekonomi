// The gate for everything under /api/stock. Authority is per stock, and most routes address a product, an
// entry or an event, so the stock has to be read off the row before anybody can be let in.
import "server-only";

import type { NextResponse } from "next/server";
import { fail, gate, type Actor } from "@/lib/api/guard";
import {
  canEnterStock,
  canManageStock,
  canMoveStock,
  canViewStock,
  type StockReach,
} from "@/lib/domain/permissions";
import { prisma } from "@/lib/server/db";
import { isStockSlug, type StockSlug } from "@/lib/stock/stocks";

/** `enter` is the least that lets somebody into a stock at all: reading it, or logging moves in it. */
type Level = "enter" | "view" | "manage" | "move";

const CAN: Record<Level, (who: StockReach, stock: StockSlug) => boolean> = {
  enter: canEnterStock,
  view: (who, stock) => canViewStock(who.capabilities, stock),
  manage: (who, stock) => canManageStock(who.capabilities, stock),
  move: canMoveStock,
};

export type StockGate =
  { ok: true; actor: Actor; stock: StockSlug } | { ok: false; res: NextResponse };

/** Let the caller into one stock, named by its slug (a query parameter, a body field). */
export async function gateStock(stock: unknown, level: Level): Promise<StockGate> {
  // Before the slug is looked at, so a signed-out caller is told that and not "no such stock".
  const g = await gate();
  if (!g.ok) return g;
  if (!isStockSlug(stock)) return { ok: false, res: fail(404, "stock.unknownStock") };
  if (!CAN[level](g.actor, stock)) {
    return { ok: false, res: fail(403, "stock.noAccess") };
  }
  return { ok: true, actor: g.actor, stock };
}

/** The same, for a route that addresses a product. A product the caller may not see reads as missing. */
export async function gateProduct(productId: string, level: Level): Promise<StockGate> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.stockProduct.findUnique({
    where: { id: productId },
    select: { stockId: true },
  });
  return admit(g.actor, row?.stockId, level, "stock.productNotFound");
}

/** For a route that addresses one row of the log. */
export async function gateEntry(entryId: string, level: Level): Promise<StockGate> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.stockEntry.findUnique({
    where: { id: entryId },
    select: { product: { select: { stockId: true } } },
  });
  return admit(g.actor, row?.product.stockId, level, "stock.entryNotFound");
}

/** For a route that addresses a night. */
export async function gateEvent(eventId: string, level: Level): Promise<StockGate> {
  const g = await gate();
  if (!g.ok) return g;
  const row = await prisma.stockEvent.findUnique({
    where: { id: eventId },
    select: { stockId: true },
  });
  return admit(g.actor, row?.stockId, level, "stock.eventNotFound");
}

function admit(actor: Actor, stock: string | undefined, level: Level, missing: string): StockGate {
  if (!isStockSlug(stock)) return { ok: false, res: fail(404, missing) };
  // Somebody with no business in the stock is not told the row exists.
  if (!canEnterStock(actor, stock)) return { ok: false, res: fail(404, missing) };
  if (!CAN[level](actor, stock)) {
    return { ok: false, res: fail(403, "stock.noAccess") };
  }
  return { ok: true, actor, stock };
}
