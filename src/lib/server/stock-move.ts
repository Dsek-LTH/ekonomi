import "server-only";

// Moving stock between storage and the stock's places (docs/stock.md, section 11). What reaches a place counts as
// used and is charged to the place's cost centre, so a move is at most two rows per product: a RETURN from where it
// came, an ISSUE to where it went. Storage is `null` and writes no row of its own, since it is what the log's sum is.
import { Prisma } from "@/lib/generated/prisma/client";
import { assertAllPossible, heldOnHandMany } from "./stock-state";
import { replayProduct } from "./stock-replay";
import type { During } from "./fiscal-year";
import type { TxClient } from "./tx";
import type { StockSlug } from "@/lib/stock/stocks";

export interface MoveLine {
  productId: string;
  units: number;
}

export type MoveResult =
  | { ok: true; written: number; duplicate: boolean }
  | { ok: false; error: string; values?: Record<string, string | number> };

/** The kinds a move writes. */
export const MOVE_KINDS = ["ISSUE", "RETURN"] as const;

type Reader = Pick<TxClient, "$queryRaw">;

/**
 * What each place has taken of each product and not brought back, within `during` (a räkenskapsår), keyed
 * `placeId|productId`. A place's bill is what it took less what it returned, so this is also the most it may return.
 */
export async function placeTaken(
  db: Reader,
  args: { placeIds: readonly string[]; productIds?: readonly string[]; during: During | null },
): Promise<Map<string, number>> {
  if (args.placeIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ placeId: string; productId: string; units: bigint }[]>(
    Prisma.sql`
      SELECT e."placeId", e."productId", SUM(e."units") AS "units"
      FROM "StockEntry" e
      WHERE e."placeId" IN (${Prisma.join(args.placeIds)})
        ${args.productIds?.length ? Prisma.sql`AND e."productId" IN (${Prisma.join(args.productIds)})` : Prisma.empty}
        ${args.during ? Prisma.sql`AND e."occurredAt" >= ${args.during.gte} AND e."occurredAt" <= ${args.during.lte}` : Prisma.empty}
      GROUP BY 1, 2`,
  );
  // An ISSUE is negative on the shelf and a RETURN positive, so what the place holds is the sum turned round.
  return new Map(rows.map((r) => [`${r.placeId}|${r.productId}`, -Number(r.units)]));
}

/**
 * Write one move in one batch. All or nothing: a line storage cannot cover, or a return of more than the place took
 * this year, refuses the whole batch and names the product. A batch already written is answered as written, so a
 * retried submit is harmless. Who may log it is the route's question (canMoveBetween).
 */
export async function moveBatch(
  tx: TxClient,
  args: {
    stock: StockSlug;
    from: string | null;
    to: string | null;
    batchId: string;
    occurredAt: Date;
    lines: readonly MoveLine[];
    actorId: string;
    /** The räkenskapsår of `occurredAt`, which bounds what a place may return. Null where none is known. */
    during: During | null;
    note?: string | null;
  },
): Promise<MoveResult> {
  const already = await tx.stockEntry.count({ where: { batchId: args.batchId } });
  if (already > 0) return { ok: true, duplicate: true, written: already };

  if (args.from === args.to) return { ok: false, error: "stock.moveNowhere" };

  const placeIds = [args.from, args.to].filter((p): p is string => p !== null);
  const places = await tx.stockPlace.findMany({
    where: { id: { in: placeIds }, stockId: args.stock, archived: false },
    select: { id: true, name: true },
  });
  if (places.length !== placeIds.length) return { ok: false, error: "stock.placeNotFound" };
  const placeName = new Map(places.map((p) => [p.id, p.name]));

  // One line per product: the same product twice in a submit is one figure.
  const wanted = new Map<string, number>();
  for (const line of args.lines) {
    wanted.set(line.productId, (wanted.get(line.productId) ?? 0) + line.units);
  }

  const products = await tx.stockProduct.findMany({
    where: { id: { in: [...wanted.keys()] }, stockId: args.stock },
    select: {
      id: true,
      name: true,
      kind: true,
      category: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
    },
  });
  if (products.length !== wanted.size) return { ok: false, error: "stock.productNotFound" };

  if (args.from === null) {
    const held = await heldOnHandMany(tx, products);
    for (const p of products) {
      const have = held.get(p.id)!.units;
      const want = wanted.get(p.id)!;
      if (want > have) {
        return {
          ok: false,
          error: "stock.notEnoughOnShelf",
          values: { name: p.name, have: Math.max(0, have), want },
        };
      }
    }
  } else {
    const taken = await placeTaken(tx, {
      placeIds: [args.from],
      productIds: products.map((p) => p.id),
      during: args.during,
    });
    for (const p of products) {
      const have = taken.get(`${args.from}|${p.id}`) ?? 0;
      const want = wanted.get(p.id)!;
      if (want > have) {
        return {
          ok: false,
          error: "stock.moreThanTaken",
          values: { name: p.name, place: placeName.get(args.from)!, have: Math.max(0, have), want },
        };
      }
    }
  }

  // The return first, so on a move between two places the shelf never reads below what it holds.
  const legs = [
    ...(args.from ? [{ kind: "RETURN" as const, placeId: args.from, sign: 1 }] : []),
    ...(args.to ? [{ kind: "ISSUE" as const, placeId: args.to, sign: -1 }] : []),
  ];

  let written = 0;
  for (const p of products) {
    const units = wanted.get(p.id)!;
    for (const leg of legs) {
      const entry = await tx.stockEntry.create({
        data: {
          productId: p.id,
          kind: leg.kind,
          units: leg.sign * units,
          // What it cost when this was written. The value it moves is settled by the replay below.
          unitCostOre: p.costPriceOre,
          placeId: leg.placeId,
          batchId: args.batchId,
          occurredAt: args.occurredAt,
          actorId: args.actorId,
          note: args.note ?? null,
        },
        select: { id: true },
      });
      await tx.stockChange.create({
        data: {
          entryId: entry.id,
          productId: p.id,
          action: "CREATE",
          kind: leg.kind,
          level: 0,
          toQty: units,
          actorId: args.actorId,
        },
      });
      written++;
    }
    // The moving average at these rows' place in the log, and every later row's after them.
    await replayProduct(tx, p.id);
  }
  return { ok: true, duplicate: false, written };
}

/** Thrown when undoing a move would leave a place having returned more than it took. Turned into a 422. */
export const RETURNED_SINCE = "stock.moveReturnedSince";

/**
 * Undo a whole move batch, with its trail. Refused (by throwing, so the transaction rolls back) when what is left
 * would be impossible: storage below zero, or a place that has since returned what this move gave it.
 */
export async function removeMoveBatch(
  tx: TxClient,
  entries: readonly {
    id: string;
    productId: string;
    kind: "ISSUE" | "RETURN";
    units: number;
    placeId: string | null;
  }[],
  actorId: string,
  during: During | null,
): Promise<void> {
  for (const e of entries) {
    await tx.stockEntry.delete({ where: { id: e.id } });
    await tx.stockChange.create({
      data: {
        entryId: e.id,
        productId: e.productId,
        action: "DELETE",
        kind: e.kind,
        level: 0,
        fromQty: Math.abs(e.units),
        actorId,
      },
    });
  }

  const productIds = [...new Set(entries.map((e) => e.productId))];
  for (const id of productIds) await replayProduct(tx, id);

  const products = await tx.stockProduct.findMany({
    where: { id: { in: productIds } },
    select: { id: true, kind: true, category: true, unitMl: true, nominalMl: true },
  });
  await assertAllPossible(tx, products);

  const issuedTo = [
    ...new Set(entries.filter((e) => e.kind === "ISSUE" && e.placeId).map((e) => e.placeId!)),
  ];
  const taken = await placeTaken(tx, { placeIds: issuedTo, productIds, during });
  if ([...taken.values()].some((units) => units < 0)) throw new Error(RETURNED_SINCE);
}
