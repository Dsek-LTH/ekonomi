// Reading the shelf out of the log, in one place.
//
// The open bottles live in four columns (open80…open20) because a rung is a
// column you can sum in the database, and every caller that wants to *think*
// about them wants the `OpenBottles` record instead. Turning one into the other
// is four lines, which is why it had been written out at eight call sites, and
// why two of them had already drifted into selecting a column they then ignored.
//
// The same goes for the shelf itself. "Sum the log, ask `onHand` what that
// means, refuse it if it is impossible" is not three steps a route should be
// choosing between: it is the invariant this whole feature exists to hold, and
// a route that gets it slightly wrong stores negative stock. It had five copies.
import "server-only";

import { impossible, onHand, type OnHand, type StockSubject } from "@/lib/stock/onhand";
import type { Level, OpenBottles } from "@/lib/stock/levels";
import type { TxClient } from "@/lib/server/tx";
import { prisma } from "@/lib/server/db";

/** Either the client or a transaction's. Every read here works on both. */
type StockReader = TxClient | typeof prisma;

/** The four rung columns, as a Prisma `_sum` selection. */
export const OPEN_SUM = {
  units: true,
  open80: true,
  open60: true,
  open40: true,
  open20: true,
} as const;

/** The same, plus what the rows did to the stock's value. */
const OPEN_SUM_WITH_VALUE = { ...OPEN_SUM, valueDeltaOre: true } as const;

/** The four columns as they come back from a `_sum`, which is nullable throughout. */
type OpenColumns = {
  open80: number | null;
  open60: number | null;
  open40: number | null;
  open20: number | null;
};

/**
 * The rung columns as an `OpenBottles` record.
 *
 * Typed as the total record rather than as `OpenBottles`, which is partial: a
 * column always has a value, so every rung is present here, and a caller
 * indexing one gets a number rather than a maybe.
 */
export const openOf = (c: OpenColumns): Record<Level, number> => ({
  80: c.open80 ?? 0,
  60: c.open60 ?? 0,
  40: c.open40 ?? 0,
  20: c.open20 ?? 0,
});

/** An `OpenBottles` record as the four columns, for a write. */
export const openColumns = (open: OpenBottles) => ({
  open80: open[80] ?? 0,
  open60: open[60] ?? 0,
  open40: open[40] ?? 0,
  open20: open[20] ?? 0,
});

/** A summed log, as the one synthetic movement `onHand` reads it from. */
const asHeld = (
  product: StockSubject,
  sum: OpenColumns & { units: number | null; valueDeltaOre?: number | null },
): OnHand =>
  onHand(product, [
    {
      // COUNT, because a sum of every delta *is* a statement of what is there,
      // which is what a stocktake is. Not a claim about how it got there.
      kind: "COUNT",
      units: sum.units ?? 0,
      open: openOf(sum),
      ...(sum.valueDeltaOre === undefined ? {} : { valueDeltaOre: sum.valueDeltaOre ?? 0 }),
    },
  ]);

/**
 * What the log says this product holds.
 *
 * `withValue` also sums what the rows were worth, which the delivery and
 * withdrawal route needs to price what is leaving and nothing else does. It is
 * a column more to sum, so it is asked for rather than always fetched.
 */
export async function heldOnHand(
  db: StockReader,
  product: StockSubject & { id: string },
  { withValue = false }: { withValue?: boolean } = {},
): Promise<OnHand> {
  const sums = await db.stockEntry.aggregate({
    where: { productId: product.id },
    _sum: withValue ? OPEN_SUM_WITH_VALUE : OPEN_SUM,
  });
  return asHeld(product, sums._sum);
}

/**
 * The same for several products at once, in one group-by.
 *
 * A product with no rows at all is absent from the group-by and present in the
 * answer, holding nothing, because "nothing on the shelf" is a fact about it
 * and a caller that had to check for a missing key would get that wrong.
 */
export async function heldOnHandMany(
  db: StockReader,
  products: readonly (StockSubject & { id: string })[],
): Promise<Map<string, OnHand>> {
  if (products.length === 0) return new Map();
  const rows = await db.stockEntry.groupBy({
    by: ["productId"],
    where: { productId: { in: products.map((p) => p.id) } },
    _sum: OPEN_SUM,
  });
  const sums = new Map(rows.map((r) => [r.productId, r._sum]));
  const empty = { units: 0, open80: 0, open60: 0, open40: 0, open20: 0 };
  return new Map(products.map((p) => [p.id, asHeld(p, sums.get(p.id) ?? empty)]));
}

/**
 * Thrown by the checks below, and caught by the routes, which turn it into a
 * 422. An Error rather than a returned code because it has to abort the
 * transaction it is found in: the write has already happened by then, and the
 * whole point is that it must not stand. See `impossible`.
 */
export const NEGATIVE_STOCK = "stock.wouldGoNegative";

/**
 * Refuse a shelf that has gone negative.
 *
 * Checked after the write rather than before it, and that is not laziness: a
 * row's effect is only knowable against every other row, so the cheapest
 * correct question is "having written this, is the shelf still possible", asked
 * inside the transaction that can still take it back.
 */
export async function assertPossible(
  db: StockReader,
  product: StockSubject & { id: string },
): Promise<void> {
  if (impossible(product, await heldOnHand(db, product))) throw new Error(NEGATIVE_STOCK);
}

/** The same over several products, in one group-by rather than one query each. */
export async function assertAllPossible(
  db: StockReader,
  products: readonly (StockSubject & { id: string })[],
): Promise<void> {
  const held = await heldOnHandMany(db, products);
  for (const product of products) {
    if (impossible(product, held.get(product.id)!)) throw new Error(NEGATIVE_STOCK);
  }
}
