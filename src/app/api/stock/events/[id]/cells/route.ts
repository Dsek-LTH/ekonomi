// Writing an event sheet, a cell at a time. A cell is a row (unique per event, product, direction,
// rung), so this makes each row say what the sheet says: created, changed or removed (zero means
// no row). History goes to StockChange. Each cell carries the figure it was decided against, and a
// mismatch is refused with the truth rather than merged. The log is replayed forward afterwards
// (lib/server/stock-replay.ts).

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { WriteStockCells } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import { entryFault } from "@/lib/stock/entry";
import { heldOnHandMany, openColumns, openOf } from "@/lib/server/stock-state";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";
import {
  cellFault,
  cellKey,
  cellQty,
  cellTotals,
  entryColumns,
  type CellKind,
  type CellRow,
} from "@/lib/stock/cells";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const { id } = await params;
  const parsed = await parseBody(req, WriteStockCells);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const event = await prisma.stockEvent.findUnique({ where: { id }, select: { id: true } });
  if (!event) return fail(404, "stock.eventNotFound");

  const productIds = [...new Set(body.cells.map((c) => c.productId))];
  const products = await prisma.stockProduct.findMany({
    where: { id: { in: productIds } },
    select: {
      id: true,
      kind: true,
      category: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
    },
  });
  if (products.length !== productIds.length) return fail(404, "stock.productNotFound");
  const byId = new Map(products.map((p) => [p.id, p]));

  const result = await bulkTransaction(async (tx) => {
    // What the event says now, and what the cellar holds.
    const existing = await tx.stockEntry.findMany({
      where: { eventId: id, productId: { in: productIds } },
      select: {
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
      },
    });
    const asRow = (e: (typeof existing)[number]): CellRow => ({
      productId: e.productId,
      kind: e.kind as CellKind,
      level: e.level,
      units: e.units,
      open: openOf(e),
      spilledQty: e.spilledQty,
    });
    const rowFor = new Map(existing.map((e) => [cellKey(asRow(e)), e]));
    const booked = cellTotals(existing.map(asRow));

    /** The sheet as this request leaves it, judged as one statement (see SheetState in lib/stock/cells.ts) so request order cannot matter. */
    const sheet = new Map(booked);
    for (const cell of body.cells) {
      sheet.set(
        cellKey({ productId: cell.productId, kind: cell.kind, level: cell.level }),
        cell.qty,
      );
    }

    const shelves = await heldOnHandMany(tx, products);
    const shelfOf = (productId: string) => {
      const held = shelves.get(productId)!;
      return { sealed: held.units, open: held.open };
    };

    const conflicts: { productId: string; kind: string; level: number; actual: number }[] = [];
    const touched = new Set<string>();
    let written = 0;

    for (const cell of body.cells) {
      const ref = { productId: cell.productId, kind: cell.kind, level: cell.level };
      const key = cellKey(ref);
      const row = rowFor.get(key);
      const now = row ? cellQty(asRow(row)) : 0;

      // Moved under them: refused rather than merged.
      if (now !== cell.expected) {
        conflicts.push({ ...ref, actual: now });
        continue;
      }
      if (cell.qty === now) continue;

      const product = byId.get(cell.productId)!;
      const bad = cellFault(product, shelfOf(cell.productId), { sheet, booked }, ref, cell.qty);
      if (bad) return { fault: bad } as const;

      const columns = entryColumns(ref, cell.qty);
      if (cell.qty > 0) {
        const wrong = entryFault({ kind: ref.kind, ...columns }, product);
        if (wrong) return { fault: wrong } as const;
      }

      if (cell.qty === 0 && row) {
        await tx.stockEntry.delete({ where: { id: row.id } });
        await tx.stockChange.create({
          data: {
            entryId: row.id,
            productId: cell.productId,
            eventId: id,
            action: "DELETE",
            kind: ref.kind,
            level: ref.level,
            fromQty: now,
            actorId: g.actor.id,
          },
        });
      } else if (row) {
        await tx.stockEntry.update({
          where: { id: row.id },
          data: {
            units: columns.units,
            ...openColumns(columns.open),
            spilledQty: columns.spilledQty,
            occurredAt: new Date(body.occurredAt),
            note: body.note ?? null,
          },
        });
        await tx.stockChange.create({
          data: {
            entryId: row.id,
            productId: cell.productId,
            eventId: id,
            action: "UPDATE",
            kind: ref.kind,
            level: ref.level,
            fromQty: now,
            toQty: cell.qty,
            actorId: g.actor.id,
          },
        });
      } else {
        const made = await tx.stockEntry.create({
          data: {
            productId: cell.productId,
            kind: ref.kind,
            level: ref.level,
            units: columns.units,
            ...openColumns(columns.open),
            spilledQty: columns.spilledQty,
            eventId: id,
            occurredAt: new Date(body.occurredAt),
            actorId: g.actor.id,
            note: body.note ?? null,
          },
          select: { id: true },
        });
        await tx.stockChange.create({
          data: {
            entryId: made.id,
            productId: cell.productId,
            eventId: id,
            action: "CREATE",
            kind: ref.kind,
            level: ref.level,
            toQty: cell.qty,
            actorId: g.actor.id,
          },
        });
      }

      // `booked` is not advanced: it and `shelfOf` describe the cellar as the request found it.
      touched.add(cell.productId);
      written++;
    }

    if (conflicts.length > 0) return { conflicts } as const;

    // Follow from the rows before them, so the log is read forward.
    for (const productId of touched) {
      await replayProduct(tx, productId);
    }

    return { written } as const;
  });

  if ("fault" in result) return fail(422, `stock.${result.fault}`);
  if ("conflicts" in result) {
    return NextResponse.json(
      { error: "stock.cellMoved", conflicts: result.conflicts },
      { status: 409 },
    );
  }
  return NextResponse.json({ written: result.written });
}
