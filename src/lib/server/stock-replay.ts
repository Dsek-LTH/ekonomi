import "server-only";

// Reading a product's log forward and writing back what it should hold. Every write path calls this: a
// count's difference and a withdrawal's moving-average cost depend on all rows before them, so they are
// re-derived. It takes no price: each row carries the cost it was booked at.

import { differs, replay, type ReplayRow } from "@/lib/stock/replay";
import { openColumns, openOf } from "./stock-state";
import type { TxClient } from "./tx";

/**
 * Gives the product's price to the rows written before it had one. Such a row was booked at
 * nothing, and a shelf booked at nothing hands that average to every later count and return,
 * so the value stays at zero until a delivery. A row that carries a price keeps it.
 */
export async function priceUnpricedRows(
  tx: TxClient,
  productId: string,
  costPriceOre: number | null,
): Promise<number> {
  if (costPriceOre == null || costPriceOre <= 0) return 0;
  const { count } = await tx.stockEntry.updateMany({
    where: { productId, unitCostOre: null },
    data: { unitCostOre: costPriceOre },
  });
  return count;
}

/** How many rows it had to write. Zero is the ordinary answer. */
export async function replayProduct(tx: TxClient, productId: string): Promise<number> {
  const rows = await tx.stockEntry.findMany({
    where: { productId },
    // The day it happened, then the order it was written.
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      kind: true,
      level: true,
      units: true,
      open80: true,
      open60: true,
      open40: true,
      open20: true,
      countedQty: true,
      valueDeltaOre: true,
      unitCostOre: true,
    },
  });

  const asRow = (r: (typeof rows)[number]): ReplayRow => ({
    id: r.id,
    kind: r.kind,
    level: r.level,
    units: r.units,
    open: openOf(r),
    countedQty: r.countedQty,
    valueDeltaOre: r.valueDeltaOre,
    unitCostOre: r.unitCostOre,
  });

  const settled = replay(rows.map(asRow));
  let written = 0;
  for (const r of rows) {
    const want = settled.get(r.id);
    if (!want || !differs(asRow(r), want)) continue;
    written++;
    await tx.stockEntry.update({
      where: { id: r.id },
      data: {
        units: want.units,
        ...openColumns(want.open),
        valueDeltaOre: want.valueDeltaOre,
      },
    });
  }
  return written;
}
