// Correcting a delivery or a stocktake.
//
// The case this exists for: somebody books 200 bottles of Fireball meaning 20.
// Until now the only way out was a second row of −180, which left the log
// saying the guild once bought two hundred bottles it never bought, and made
// putting it right an arithmetic problem at the moment somebody has already
// shown they are not doing arithmetic well.
//
// So the row is changed. What it said before, and who changed it, goes to
// StockChange, which is what keeps an editable ledger checkable, and is read
// as a feed on the product's own page.
//
// A count is no obstacle to any of this, which is worth saying because it once
// was. A stocktake states what was on the shelf on a day, so once its own
// difference is worked out again (see lib/server/stock-replay.ts) correcting
// a delivery from before it cannot move anything after it. Everything before a
// count genuinely stops mattering, which is what an inventering has always
// meant.
//
// The one thing it will not do is move stock into an impossible place: the
// shelf is checked against what the row would become, not against what it was.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockEntry } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import { entryFault } from "@/lib/stock/entry";
import type { OpenBottles } from "@/lib/stock/levels";
import { impossible, onHand } from "@/lib/stock/onhand";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";

/** The figure a row shows a person: positive, in things. */
const shown = (e: { kind: string; units: number; spilledQty: number; level: number; open80: number; open60: number; open40: number; open20: number }): number => {
  if (e.kind === "WASTE") return Math.abs(e.spilledQty);
  if (e.level === 0) return Math.abs(e.units);
  const at: Record<number, number> = { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 };
  return Math.abs(at[e.level] ?? 0);
};

const ENTRY = {
  id: true,
  productId: true,
  kind: true,
  level: true,
  units: true,
  open80: true,
  open60: true,
  open40: true,
  open20: true,
  spilledQty: true,
  occurredAt: true,
  createdAt: true,
  note: true,
  eventId: true,
} as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const { id } = await params;
  const parsed = await parseBody(req, PatchStockEntry);
  if (!parsed.ok) return parsed.res;

  const entry = await prisma.stockEntry.findUnique({ where: { id }, select: ENTRY });
  if (!entry) return fail(404, "stock.entryNotFound");
  // A night's figures are the sheet's business, and it has its own rules about
  // what may go in a cell.
  if (entry.eventId) return fail(422, "stock.onTheSheet");

  const product = await prisma.stockProduct.findUnique({
    where: { id: entry.productId },
    select: { id: true, kind: true, category: true, unitMl: true, nominalMl: true, costPriceOre: true },
  });
  if (!product) return fail(404, "stock.productNotFound");

  const was = shown(entry);
  const qty = parsed.data.qty;

  // What the row becomes. Only its size changes; which rung and which direction
  // it was are what it *is*, and a row that changed those would be a different
  // movement wearing an old row's history.
  const sign = entry.kind === "CHECKOUT" || entry.kind === "WASTE" ? -1 : 1;
  const open: OpenBottles = {};
  let units = 0;
  let spilledQty = 0;
  if (entry.kind === "WASTE") spilledQty = qty;
  else if (entry.level === 0) units = entry.kind === "COUNT" ? entry.units : sign * qty;
  else open[entry.level as 80] = entry.kind === "COUNT" ? (entry.open80 ?? 0) : sign * qty;
  if (entry.kind === "COUNT") return fail(422, "stock.recountInstead");

  const fault = entryFault({ kind: entry.kind, units, open, spilledQty }, product);
  if (fault) return fail(422, `stock.${fault}`);

  const updated = await bulkTransaction(async (tx) => {
    await tx.stockEntry.update({
      where: { id },
      data: {
        units,
        open80: open[80] ?? 0,
        open60: open[60] ?? 0,
        open40: open[40] ?? 0,
        open20: open[20] ?? 0,
        spilledQty,
        occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
        note: parsed.data.note === undefined ? undefined : (parsed.data.note ?? null),
      },
    });

    // The shelf, as it now stands. Checked after the fact rather than before
    // because a row's effect is only knowable against everything else.
    const sums = await tx.stockEntry.aggregate({
      where: { productId: entry.productId },
      _sum: { units: true, open80: true, open60: true, open40: true, open20: true },
    });
    const state = onHand(product, [
      {
        kind: "COUNT",
        units: sums._sum.units ?? 0,
        open: {
          80: sums._sum.open80 ?? 0,
          60: sums._sum.open60 ?? 0,
          40: sums._sum.open40 ?? 0,
          20: sums._sum.open20 ?? 0,
        },
      },
    ]);
    if (impossible(product, state)) throw new Error("stock.wouldGoNegative");

    await tx.stockChange.create({
      data: {
        entryId: id,
        productId: entry.productId,
        action: "UPDATE",
        kind: entry.kind,
        level: entry.level,
        fromQty: was,
        toQty: qty,
        actorId: g.actor.id,
      },
    });
    await replayProduct(tx, entry.productId);
    return true;
  }).catch((e: Error) => e.message);

  if (updated !== true) return fail(422, typeof updated === "string" ? updated : "stock.wouldGoNegative");
  return NextResponse.json({ id });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const { id } = await params;
  const entry = await prisma.stockEntry.findUnique({ where: { id }, select: ENTRY });
  if (!entry) return fail(404, "stock.entryNotFound");
  if (entry.eventId) return fail(422, "stock.onTheSheet");

  const product = await prisma.stockProduct.findUnique({
    where: { id: entry.productId },
    select: { id: true, kind: true, category: true, unitMl: true, nominalMl: true, costPriceOre: true },
  });
  if (!product) return fail(404, "stock.productNotFound");

  const gone = await bulkTransaction(async (tx) => {
    await tx.stockEntry.delete({ where: { id } });
    const sums = await tx.stockEntry.aggregate({
      where: { productId: entry.productId },
      _sum: { units: true, open80: true, open60: true, open40: true, open20: true },
    });
    const state = onHand(product, [
      {
        kind: "COUNT",
        units: sums._sum.units ?? 0,
        open: {
          80: sums._sum.open80 ?? 0,
          60: sums._sum.open60 ?? 0,
          40: sums._sum.open40 ?? 0,
          20: sums._sum.open20 ?? 0,
        },
      },
    ]);
    if (impossible(product, state)) throw new Error("stock.wouldGoNegative");

    await tx.stockChange.create({
      data: {
        entryId: id,
        productId: entry.productId,
        action: "DELETE",
        kind: entry.kind,
        level: entry.level,
        fromQty: shown(entry),
        actorId: g.actor.id,
      },
    });
    await replayProduct(tx, entry.productId);
    return true;
  }).catch((e: Error) => e.message);

  if (gone !== true) return fail(422, typeof gone === "string" ? gone : "stock.wouldGoNegative");
  return NextResponse.json({ ok: true });
}
