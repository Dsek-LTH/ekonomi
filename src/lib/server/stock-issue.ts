import "server-only";

// Writing and undoing a batch of stock that left storage and is not expected back, several products in one submit.
// The board's tab uses it for WITHDRAWAL. A move to or from a place is lib/server/stock-move.ts.
import { heldOnHandMany } from "./stock-state";
import { replayProduct } from "./stock-replay";
import type { TxClient } from "./tx";
import type { StockSlug } from "@/lib/stock/stocks";

export interface IssueLine {
  productId: string;
  units: number;
}

export type IssueResult =
  | { ok: true; entries: { id: string; productId: string; units: number }[]; duplicate: boolean }
  | { ok: false; error: string; values?: Record<string, string | number> };

/**
 * Take `lines` off the shelf in one batch. All or nothing: a line the log cannot cover refuses the whole batch and
 * names the product, because a shelf below zero has no cost to charge. A batch already written is answered with
 * what it wrote, so a retried submit is harmless.
 */
export async function issueBatch(
  tx: TxClient,
  args: {
    stock: StockSlug;
    kind: "ISSUE" | "WITHDRAWAL";
    batchId: string;
    occurredAt: Date;
    lines: readonly IssueLine[];
    actorId: string;
    note?: string | null;
  },
): Promise<IssueResult> {
  const already = await tx.stockEntry.findMany({
    where: { batchId: args.batchId },
    select: { id: true, productId: true, units: true },
  });
  if (already.length > 0) {
    return {
      ok: true,
      duplicate: true,
      entries: already.map((e) => ({ id: e.id, productId: e.productId, units: -e.units })),
    };
  }

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

  const entries: { id: string; productId: string; units: number }[] = [];
  for (const p of products) {
    const units = wanted.get(p.id)!;
    const entry = await tx.stockEntry.create({
      data: {
        productId: p.id,
        kind: args.kind,
        units: -units,
        // What it cost when this was written. The value it takes off the shelf is settled by the replay below.
        unitCostOre: p.costPriceOre,
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
        kind: args.kind,
        level: 0,
        toQty: units,
        actorId: args.actorId,
      },
    });
    // The moving average at this row's place in the log, and every later row's after it.
    await replayProduct(tx, p.id);
    entries.push({ id: entry.id, productId: p.id, units });
  }
  return { ok: true, duplicate: false, entries };
}

/** Remove one entry of a batch, with its trail, and settle the product again. */
export async function removeIssueEntry(
  tx: TxClient,
  entry: { id: string; productId: string; kind: "ISSUE" | "WITHDRAWAL"; units: number },
  actorId: string,
): Promise<void> {
  await tx.stockEntry.delete({ where: { id: entry.id } });
  await tx.stockChange.create({
    data: {
      entryId: entry.id,
      productId: entry.productId,
      action: "DELETE",
      kind: entry.kind,
      level: 0,
      fromQty: Math.abs(entry.units),
      actorId,
    },
  });
  await replayProduct(tx, entry.productId);
}
