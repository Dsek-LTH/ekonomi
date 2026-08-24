// Writing an event sheet, a cell at a time.
//
// A cell is a row: one per occasion, product, direction and rung, which the
// database enforces. So this does not append movements — it makes each row say
// what the sheet says, creating it, changing it or removing it. Zero means
// there should be no row, because a figure of nothing is not a movement of
// nothing; it is the absence of one.
//
// That is the whole reason a mistake no longer pollutes the log. Booking 200
// bottles and meaning 20 used to leave both figures in the ledger forever, one
// cancelling the other. Now the row says 20 and what happened to it is recorded
// where it belongs: in StockChange, which is read as a feed on the occasion and
// on the product.
//
// Three things this has to get right that a browser cannot be trusted with.
//
// Nothing may be written over somebody else's work unseen. Every cell carries
// the figure it was decided against, and one that no longer matches is refused
// with the truth rather than merged.
//
// And the log is read forward afterwards. A stocktake states what was on the
// shelf and cost of goods rides on a moving average, so both depend on
// everything before them — see lib/server/stock-replay.ts. Which is also why
// nothing here is frozen behind a count: the count holds by being re-derived,
// not by forbidding the rows in front of it to change.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { WriteStockCells } from "@/lib/api/schemas/stock";
import { canManageStock } from "@/lib/domain/permissions";
import { entryFault } from "@/lib/stock/entry";
import { onHand } from "@/lib/stock/onhand";
import { replayProduct } from "@/lib/server/stock-replay";
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

  const tag = await prisma.stockTag.findUnique({ where: { id }, select: { id: true } });
  if (!tag) return fail(404, "stock.tagNotFound");

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

  const result = await prisma.$transaction(async (tx) => {
    // What the occasion says now, and what the cellar holds.
    const existing = await tx.stockEntry.findMany({
      where: { tagId: id, productId: { in: productIds } },
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
      open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 },
      spilledQty: e.spilledQty,
    });
    const rowFor = new Map(existing.map((e) => [cellKey(asRow(e)), e]));
    const cells = cellTotals(existing.map(asRow));

    const shelves = await tx.stockEntry.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds } },
      _sum: { units: true, open80: true, open60: true, open40: true, open20: true },
    });
    const shelfOf = (productId: string) => {
      const row = shelves.find((s) => s.productId === productId);
      const held = onHand(byId.get(productId)!, [
        {
          kind: "COUNT",
          units: row?._sum.units ?? 0,
          open: {
            80: row?._sum.open80 ?? 0,
            60: row?._sum.open60 ?? 0,
            40: row?._sum.open40 ?? 0,
            20: row?._sum.open20 ?? 0,
          },
        },
      ]);
      return { sealed: held.units, open: held.open };
    };

    const conflicts: { productId: string; kind: string; level: number; actual: number }[] = [];
    const touched = new Set<string>();
    let written = 0;

    for (const cell of body.cells) {
      const ref = { productId: cell.productId, kind: cell.kind as CellKind, level: cell.level };
      const key = cellKey(ref);
      const row = rowFor.get(key);
      const now = row ? cellQty(asRow(row)) : 0;

      // Moved under them: refused rather than merged. Both readings are
      // somebody's honest arithmetic and nothing here can tell which was meant.
      if (now !== cell.expected) {
        conflicts.push({ ...ref, actual: now });
        continue;
      }
      if (cell.qty === now) continue;

      const product = byId.get(cell.productId)!;
      const bad = cellFault(product, shelfOf(cell.productId), cells, ref, cell.qty);
      if (bad) return { fault: bad } as const;

      const columns = entryColumns(ref, cell.qty);
      if (cell.qty > 0) {
        const wrong = entryFault({ kind: ref.kind, ...columns }, product);
        if (wrong) return { fault: wrong } as const;
      }

      // ── Make the row say it ──
      if (cell.qty === 0 && row) {
        await tx.stockEntry.delete({ where: { id: row.id } });
        await tx.stockChange.create({
          data: {
            entryId: row.id,
            productId: cell.productId,
            tagId: id,
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
            open80: columns.open[80] ?? 0,
            open60: columns.open[60] ?? 0,
            open40: columns.open[40] ?? 0,
            open20: columns.open[20] ?? 0,
            spilledQty: columns.spilledQty,
            occurredAt: new Date(body.occurredAt),
            note: body.note ?? null,
          },
        });
        await tx.stockChange.create({
          data: {
            entryId: row.id,
            productId: cell.productId,
            tagId: id,
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
            open80: columns.open[80] ?? 0,
            open60: columns.open[60] ?? 0,
            open40: columns.open[40] ?? 0,
            open20: columns.open[20] ?? 0,
            spilledQty: columns.spilledQty,
            tagId: id,
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
            tagId: id,
            action: "CREATE",
            kind: ref.kind,
            level: ref.level,
            toQty: cell.qty,
            actorId: g.actor.id,
          },
        });
      }

      cells.set(key, cell.qty);
      touched.add(cell.productId);
      written++;
    }

    if (conflicts.length > 0) return { conflicts } as const;

    // What a count has to say, and what everything cost, both follow from the
    // rows before them — so the log is read forward rather than patched.
    for (const productId of touched) {
      await replayProduct(tx, productId, byId.get(productId)!.costPriceOre);
    }

    return { written } as const;
  });

  if ("fault" in result) return fail(422, `stock.${result.fault}`);
  if ("conflicts" in result) {
    return NextResponse.json({ error: "stock.cellMoved", conflicts: result.conflicts }, { status: 409 });
  }
  return NextResponse.json({ written: result.written });
}
