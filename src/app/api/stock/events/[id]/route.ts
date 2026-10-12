// One event: what it moved per product, and undoing it.
//
// The register reads this to know how much of a night is still unaccounted for:
// that figure is the ceiling on anything coming back or being written off, and
// it is the same number the event's page calls sold. Those are the same thing
// until somebody carries the crates back, which is the ambiguity an event that is
// never closed accepts on purpose.
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

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const event = await getStockEvent(id);
  if (!event) return fail(404, "stock.eventNotFound");
  return NextResponse.json(event);
}

/**
 * Rename a night, or move it to another day.
 *
 * The name is only a label. The date is not: every row booked on the night
 * carries it as `occurredAt`, and that is the order the log is read in. A night
 * moved to before an inventering is counted against it differently, and the
 * moving average it was priced at is a different one. So the rows move with the
 * night, and every product it touched is replayed, the same as when a night is
 * removed.
 *
 * Rows are moved whenever any of them is not on the night's date, not only when
 * the date changes. The sheet used to let rows be stamped with a date of their
 * own, and saving the night is the moment to bring those back in line.
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

      // Checked for the same reason a removal checks: a replay can land a rung
      // below zero, and negative stock is always a bookkeeping fault.
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
    date: saved.date.toISOString().slice(0, 10),
  });
}

/**
 * Undo a night.
 *
 * Two different acts wearing one word, the same way removing a product is. Over
 * a duplicate somebody made a minute ago this takes away a name and nothing
 * else. Over a pub that ran in March it takes back every movement booked on it,
 * which puts the crates that went out back on the shelf and takes off whatever
 * came home part-used. That is what an event *is*: it holds no figures of its
 * own, only the rows that point at it, so removing it and removing them is one
 * act and cannot be anything else.
 *
 * So the page has to say which of the two it is about to do before it asks. See
 * `remove` in stock/events/[id]/event-client.tsx.
 *
 * What comes back is priced by replaying each product the night touched, rather
 * than by adding the deleted rows back up. The moving average moves with every
 * row before it, so the value of a checkout that is being undone is not the
 * value the next withdrawal should carry. Replaying is the only way to get the
 * shelf to what it would have been had the night never been entered. See
 * lib/server/stock-replay.ts.
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
    // A correction names the row it corrects, and that relation refuses to let
    // its target go. Loosening it first is what lets the night be removed
    // without taking a row that was never part of it. The correction stays, as
    // a movement that no longer says what it was amending, which is the honest
    // record: it happened, and the thing it pointed at did not.
    await tx.stockEntry.updateMany({
      where: { corrects: { eventId: id } },
      data: { correctsId: null },
    });
    const entries = await tx.stockEntry.deleteMany({ where: { eventId: id } });
    // The feed of who typed what into which cell. It describes cells that are
    // about to stop existing, and it is only ever read on the event's own page,
    // so it goes with the page. See `getProductCellar`, which skips these.
    await tx.stockChange.deleteMany({ where: { eventId: id } });
    await tx.stockEvent.delete({ where: { id } });

    for (const productId of productIds) await replayProduct(tx, productId);

    // The shelf as it now stands, per product. A night is not symmetrical:
    // a bottle can go out sealed and come home at 40 %, so undoing it puts
    // the sealed one back and takes a 40 % one away. If that one has since
    // gone out to another night, the rung it left goes negative, and negative
    // stock is always a bookkeeping fault rather than a fact.
    //
    // Every product at once, after every replay rather than between them: a
    // product's shelf is not settled until its own replay has run, and asking
    // per product was two queries each inside a transaction a whole night's
    // worth of products is waiting on.
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
