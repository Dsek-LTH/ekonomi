import "server-only";

// Reading a product's log forward, and writing back what it should hold.
//
// Every write path calls this after it has changed something: the sheet, a
// delivery being corrected, a stocktake being recorded. Two things in the log
// depend on everything before them: what a count's difference has to be, and
// what a withdrawal cost at the moving average, so both are worked out again
// rather than patched. The rule itself is pure and tested; this is only the
// part that talks to the database.
//
// It is also what makes editing safe. A count states what was on the shelf, so
// once its difference is re-derived, correcting a delivery from last month
// cannot move today's figure: everything before the count stops mattering,
// which is what an inventering has always meant.
//
// What this deliberately does *not* take is a price. Every row carries the cost
// it was booked at, so a replay reproduces exactly what it reproduced last
// time, however often the product has been re-priced since. A past value moves
// only when somebody corrects the row that holds it, which is a different
// action with a record of its own.

import { differs, replay, type ReplayRow } from "@/lib/stock/replay";
import { openColumns, openOf } from "./stock-state";
import type { TxClient } from "./tx";

/** How many rows it had to write. Nothing to report is the ordinary answer:
 *  every write path calls this, so the log is usually already settled. */
export async function replayProduct(tx: TxClient, productId: string): Promise<number> {
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
