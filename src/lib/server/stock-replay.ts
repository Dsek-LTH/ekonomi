import "server-only";

// Reading a product's log forward, and writing back what it should hold.
//
// Every write path calls this after it has changed something: the sheet, a
// delivery being corrected, a stocktake being recorded. Two things in the log
// depend on everything before them — what a count's difference has to be, and
// what a withdrawal cost at the moving average — so both are worked out again
// rather than patched. The rule itself is pure and tested; this is only the
// part that talks to the database.
//
// It is also what makes editing safe. A count states what was on the shelf, so
// once its difference is re-derived, correcting a delivery from last month
// cannot move today's figure: everything before the count stops mattering,
// which is what an inventering has always meant.

import { differs, replay, type ReplayRow } from "@/lib/stock/replay";
import type { prisma } from "./db";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export async function replayProduct(
  tx: Tx,
  productId: string,
  costPriceOre: number | null | undefined,
): Promise<void> {
  const rows = await tx.stockEntry.findMany({
    where: { productId },
    // The day it happened, then the order it was written. The only tiebreak
    // that is stable, and the only one a reader would agree with.
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
    },
  });

  const asRow = (r: (typeof rows)[number]): ReplayRow => ({
    id: r.id,
    kind: r.kind,
    level: r.level,
    units: r.units,
    open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
    countedQty: r.countedQty,
    valueDeltaOre: r.valueDeltaOre,
  });

  const settled = replay(rows.map(asRow), costPriceOre);
  for (const r of rows) {
    const want = settled.get(r.id);
    if (!want || !differs(asRow(r), want)) continue;
    await tx.stockEntry.update({
      where: { id: r.id },
      data: {
        units: want.units,
        open80: want.open[80] ?? 0,
        open60: want.open[60] ?? 0,
        open40: want.open[40] ?? 0,
        open20: want.open[20] ?? 0,
        valueDeltaOre: want.valueDeltaOre,
      },
    });
  }
}
