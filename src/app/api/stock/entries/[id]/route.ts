// Correcting a row that belongs to the cellar rather than a night (delivery, stocktake, write-off).
// The row is changed in place; the before-state and who changed it go to StockChange. The shelf is
// checked against what the row would become (lib/server/stock-replay.ts re-derives later counts).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { PatchStockEntry } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import { entryFault } from "@/lib/stock/entry";
import type { OpenBottles } from "@/lib/stock/levels";
import { assertPossible, NEGATIVE_STOCK, openColumns, openOf } from "@/lib/server/stock-state";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";

/** The figure a row shows a person: positive, in things. */
const shown = (e: {
  kind: string;
  units: number;
  spilledQty: number;
  level: number;
  open80: number;
  open60: number;
  open40: number;
  open20: number;
}): number => {
  if (e.kind === "WASTE") return Math.abs(e.spilledQty);
  if (e.level === 0) return Math.abs(e.units);
  // Widened to `number`: `level` is a column, and an unknown rung reads as nothing.
  const at: Record<number, number> = openOf(e);
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
  // A night's figures are the sheet's business.
  if (entry.eventId) return fail(422, "stock.onTheSheet");

  const product = await prisma.stockProduct.findUnique({
    where: { id: entry.productId },
    select: {
      id: true,
      kind: true,
      category: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
    },
  });
  if (!product) return fail(404, "stock.productNotFound");

  const was = shown(entry);
  const qty = parsed.data.qty;

  // Only the size changes: rung and direction are what the row is.
  const sign =
    entry.kind === "CHECKOUT" || entry.kind === "WASTE" || entry.kind === "SPOILAGE" ? -1 : 1;
  const open: OpenBottles = {};
  let units = 0;
  let spilledQty = 0;
  if (entry.kind === "WASTE") spilledQty = qty;
  else if (entry.level === 0) units = entry.kind === "COUNT" ? entry.units : sign * qty;
  else open[entry.level as 80] = entry.kind === "COUNT" ? entry.open80 : sign * qty;
  if (entry.kind === "COUNT") return fail(422, "stock.recountInstead");

  const fault = entryFault({ kind: entry.kind, units, open, spilledQty }, product);
  if (fault) return fail(422, `stock.${fault}`);

  const updated = await bulkTransaction(async (tx) => {
    await tx.stockEntry.update({
      where: { id },
      data: {
        units,
        ...openColumns(open),
        spilledQty,
        occurredAt: parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : undefined,
        note: parsed.data.note === undefined ? undefined : (parsed.data.note ?? null),
      },
    });

    // The shelf as it stands, checked after because a row's effect depends on the rest.
    await assertPossible(tx, product);

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

  if (updated !== true) return fail(422, typeof updated === "string" ? updated : NEGATIVE_STOCK);
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
    select: {
      id: true,
      kind: true,
      category: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
    },
  });
  if (!product) return fail(404, "stock.productNotFound");

  const gone = await bulkTransaction(async (tx) => {
    await tx.stockEntry.delete({ where: { id } });
    await assertPossible(tx, product);

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

  if (gone !== true) return fail(422, typeof gone === "string" ? gone : NEGATIVE_STOCK);
  // 204 rather than `{ ok: true }` (lib/api/guard.ts rules that shape out).
  return new Response(null, { status: 204 });
}
