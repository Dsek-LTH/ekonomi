// Undoing a move: the whole submit, as it was made. Whoever logged it may take it back the same day. After that it
// is the stock's keeper's to correct, row by row in the history like any other movement.

import { fail, gate } from "@/lib/api/guard";
import { canEnterStock, canManageStock } from "@/lib/domain/permissions";
import { isoDay, stockholmDay } from "@/lib/domain/date";
import { prisma } from "@/lib/server/db";
import { fiscalYearAround } from "@/lib/server/fiscal-year";
import { MOVE_KINDS, removeMoveBatch } from "@/lib/server/stock-move";
import { NEGATIVE_STOCK } from "@/lib/server/stock-state";
import { bulkTransaction } from "@/lib/server/tx";
import { isStockSlug } from "@/lib/stock/stocks";

export async function DELETE(_req: Request, ctx: { params: Promise<{ batchId: string }> }) {
  const g = await gate();
  if (!g.ok) return g.res;
  const { batchId } = await ctx.params;

  const entries = await prisma.stockEntry.findMany({
    where: { batchId, kind: { in: [...MOVE_KINDS] }, placeId: { not: null } },
    select: {
      id: true,
      productId: true,
      kind: true,
      units: true,
      placeId: true,
      actorId: true,
      createdAt: true,
      occurredAt: true,
      product: { select: { stockId: true } },
    },
  });
  const stock = entries[0]?.product.stockId;
  if (!isStockSlug(stock) || !canEnterStock(g.actor, stock)) {
    return fail(404, "stock.entryNotFound");
  }

  const own =
    entries.every((e) => e.actorId === g.actor.id) &&
    entries.every((e) => stockholmDay.format(e.createdAt) === stockholmDay.format(new Date()));
  if (!own && !canManageStock(g.actor.capabilities, stock)) {
    return fail(403, "stock.moveNotYours");
  }

  const during = await fiscalYearAround(isoDay(entries[0].occurredAt));
  const done = await bulkTransaction(async (tx) => {
    await removeMoveBatch(
      tx,
      entries.map((e) => ({
        id: e.id,
        productId: e.productId,
        kind: e.kind as (typeof MOVE_KINDS)[number],
        units: e.units,
        placeId: e.placeId,
      })),
      g.actor.id,
      during,
    );
    return true;
  }).catch((e: Error) => e.message);

  if (done !== true) return fail(422, typeof done === "string" ? done : NEGATIVE_STOCK);
  return new Response(null, { status: 204 });
}
