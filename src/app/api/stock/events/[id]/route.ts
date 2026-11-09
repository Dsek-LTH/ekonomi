// One event: what it moved per product, and undoing it. The register reads this for how much of a
// night is still unaccounted for, the ceiling on anything coming back or written off.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockEvent } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { getStockEvent } from "@/lib/data/stock";
import { assertAllPossible } from "@/lib/server/stock-state";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";
import { isoDay } from "@/lib/domain/date";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const event = await getStockEvent(id);
  if (!event) return fail(404, "stock.eventNotFound");
  return NextResponse.json(event);
}

/**
 * Rename a night, or move it to another day. The rows move with the night (their `occurredAt` is
 * the log order) and every product it touched is replayed. Rows are moved whenever any is off the
 * night's date, not only when the date changes.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, PatchStockEvent);
  if (!parsed.ok) return parsed.res;

  const event = await prisma.stockEvent.findUnique({ where: { id }, select: { id: true } });
  if (!event) return fail(404, "stock.eventNotFound");

  const day = new Date(parsed.data.date);

  const saved = await bulkTransaction(async (tx) => {
    const updated = await tx.stockEvent.update({
      where: { id },
      data: { name: parsed.data.name, date: day },
      select: { id: true, name: true, date: true },
    });

    const moved = await tx.stockEntry.updateMany({
      where: { eventId: id, occurredAt: { not: day } },
      data: { occurredAt: day },
    });

    if (moved.count > 0) {
      const touched = await tx.stockEntry.findMany({
        where: { eventId: id },
        select: { productId: true },
        distinct: ["productId"],
      });
      const productIds = touched.map((t) => t.productId);
      for (const productId of productIds) await replayProduct(tx, productId);

      // Checked as a removal is: a replay can land a rung below zero.
      const products = await tx.stockProduct.findMany({
        where: { id: { in: productIds } },
        select: { id: true, kind: true, category: true, unitMl: true, nominalMl: true },
      });
      await assertAllPossible(tx, products);
    }

    return updated;
  }).catch((e: Error) => e.message);

  if (typeof saved === "string") return fail(422, saved);
  return NextResponse.json({
    id: saved.id,
    name: saved.name,
    date: isoDay(saved.date),
  });
}

/**
 * Undo a night: removes the event and every movement booked on it (it holds no figures of its
 * own), so the page must say which of the two it is about to do (see `remove` in
 * stock/events/[id]/event-client.tsx). Products are replayed rather than re-summed, since the
 * moving average depends on every earlier row (lib/server/stock-replay.ts).
 */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const event = await prisma.stockEvent.findUnique({ where: { id }, select: { id: true } });
  if (!event) return fail(404, "stock.eventNotFound");

  const touched = await prisma.stockEntry.findMany({
    where: { eventId: id },
    select: { productId: true },
    distinct: ["productId"],
  });
  const productIds = touched.map((t) => t.productId);

  const gone = await bulkTransaction(async (tx) => {
    // A correction's relation refuses to let its target go. Loosen it first, so the night can be
    // removed without the correction, which stays.
    await tx.stockEntry.updateMany({
      where: { corrects: { eventId: id } },
      data: { correctsId: null },
    });
    const entries = await tx.stockEntry.deleteMany({ where: { eventId: id } });
    // The feed describes cells that are about to stop existing. See `getProductCellar`.
    await tx.stockChange.deleteMany({ where: { eventId: id } });
    await tx.stockEvent.delete({ where: { id } });

    for (const productId of productIds) await replayProduct(tx, productId);

    // The shelf per product, after every replay. Undoing is not symmetrical (sealed out, 40 % home),
    // so a rung can go negative if the bottle has since gone to another night: a bookkeeping fault.
    // Read for all products at once, not per product inside the transaction.
    const products = await tx.stockProduct.findMany({
      where: { id: { in: productIds } },
      select: { id: true, kind: true, category: true, unitMl: true, nominalMl: true },
    });
    await assertAllPossible(tx, products);

    return { entries: entries.count, products: productIds.length };
  }).catch((e: Error) => e.message);

  if (typeof gone === "string") return fail(422, gone);
  return NextResponse.json(gone);
}
