// Write to the log, and read it back. POST only: stock entries are never edited or deleted, a
// mistake is a new row naming the row it corrects.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { CreateStockEntry } from "@/lib/api/schemas/stock";
import { canManageStock, canViewStock } from "@/lib/domain/permissions";
import { entryFault, type ProposedEntry } from "@/lib/stock/entry";
import { LEVELS, isLevel, pickFault, shortfall, type OpenBottles } from "@/lib/stock/levels";
import { movementVolume, spillVolume, tagTotals, unaccounted } from "@/lib/stock/event";
import { heldOnHand, openColumns, openOf } from "@/lib/server/stock-state";
import { bestBeforeOf } from "@/lib/stock/expiry";
import { costBasis, valueDelta } from "@/lib/stock/value";
import { replayProduct } from "@/lib/server/stock-replay";
import { bulkTransaction } from "@/lib/server/tx";
import { getStockLog } from "@/lib/data/stock";
import type { StockEntryKind } from "@/lib/domain/types";

export async function GET(req: Request) {
  const g = await gate(canViewStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const url = new URL(req.url);
  const take = Number(url.searchParams.get("take"));
  // Repeated or comma-separated.
  const many = (key: string) =>
    url.searchParams
      .getAll(key)
      .flatMap((v) => v.split(","))
      .filter(Boolean);
  const log = await getStockLog({
    productIds: many("product"),
    kinds: many("kind") as StockEntryKind[],
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    take: Number.isFinite(take) && take > 0 ? Math.min(take, 1000) : undefined,
  });
  return NextResponse.json(log);
}

// The product as a movement needs it.
function findProduct(id: string) {
  return prisma.stockProduct.findUnique({
    where: { id },
    select: {
      id: true,
      kind: true,
      category: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
      shelfLifeMonths: true,
    },
  });
}
type Product = NonNullable<Awaited<ReturnType<typeof findProduct>>>;

// A stocktake stores the counted figure per rung; the difference is derived by the replay
// (lib/stock/replay.ts).
async function recordStocktake(
  body: CreateStockEntry & { counted: NonNullable<CreateStockEntry["counted"]> },
  product: Product,
  actorId: string,
) {
  if (body.kind !== "COUNT") return fail(422, "stock.countedOnStocktakeOnly");
  const wanted = [
    { level: 0, qty: body.counted.sealed },
    ...LEVELS.map((level) => ({
      level,
      qty: body.counted?.open?.[String(level) as "80"] ?? 0,
    })),
  ].filter((w) => product.kind === "VOLUME" || w.level === 0);

  // Two statements rather than ten (a VOLUME stocktake is five rungs).
  const made = await bulkTransaction(async (tx) => {
    const rows = await tx.stockEntry.createManyAndReturn({
      data: wanted.map((w) => ({
        productId: product.id,
        kind: "COUNT" as const,
        level: w.level,
        countedQty: w.qty,
        // The cost today, kept on the row so later price edits cannot move it.
        unitCostOre: product.costPriceOre,
        occurredAt: new Date(body.occurredAt),
        actorId: actorId,
        note: body.note ?? null,
      })),
      select: { id: true },
    });
    // In the order given, which pairs each row with its rung.
    await tx.stockChange.createMany({
      data: rows.map((row, i) => ({
        entryId: row.id,
        productId: product.id,
        action: "CREATE" as const,
        kind: "COUNT" as const,
        level: wanted[i].level,
        toQty: wanted[i].qty,
        actorId: actorId,
      })),
    });
    await replayProduct(tx, product.id);
    return rows.map((r) => r.id);
  });
  return NextResponse.json({ id: made[0] }, { status: 201 });
}

// The three kinds that make up a night must name an event, or the rows can never be reconciled.
const NEEDS_EVENT: StockEntryKind[] = ["CHECKOUT", "RETURN", "WASTE"];

/** Whether this movement names its night (or, for cellar kinds, none), and what that night still has out of this product. */
async function nightCeiling(
  body: CreateStockEntry,
  product: Product,
): Promise<{ ok: true; stillOut: number } | { ok: false; res: NextResponse }> {
  if (NEEDS_EVENT.includes(body.kind)) {
    if (!body.eventId) return { ok: false, res: fail(422, "stock.eventRequired") };
    const event = await prisma.stockEvent.findUnique({
      where: { id: body.eventId },
      select: { id: true },
    });
    if (!event) return { ok: false, res: fail(422, "stock.eventNotFound") };
  } else if (body.eventId) {
    // Cellar kinds must not carry an event, or stock enters a night's arithmetic that never went
    // to it (SPOILAGE would take the same bottle away twice).
    return { ok: false, res: fail(422, "stock.eventOnNightOnly") };
  }

  // What this event has already moved of this product: the ceiling for returns and write-offs.
  let stillOut = 0;
  if (body.eventId) {
    const booked = await prisma.stockEntry.findMany({
      where: { eventId: body.eventId, productId: product.id },
      select: {
        kind: true,
        units: true,
        open80: true,
        open60: true,
        open40: true,
        open20: true,
        spilledQty: true,
        level: true,
      },
    });
    stillOut = unaccounted(
      tagTotals(
        product,
        booked.map((b) => ({
          kind: b.kind,
          units: b.units,
          open: openOf(b),
          spilledQty: b.spilledQty,
          level: b.level,
        })),
      ),
    );
  }

  return { ok: true, stillOut };
}

export async function POST(req: Request) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockEntry);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const product = await findProduct(body.productId);
  if (!product) return fail(404, "stock.productNotFound");

  // A stocktake states the shelf rather than moving anything.
  if (body.counted) return recordStocktake({ ...body, counted: body.counted }, product, g.actor.id);

  // What the log holds: to check the bottles are on the shelf and to price what leaves.
  const held = await heldOnHand(prisma, product, { withValue: true });

  // The body picks bottles already on a rung. `pickFault` is the bar's rule, shared with the form.
  let units = body.units ?? 0;
  const open: OpenBottles = {};
  for (const level of LEVELS) {
    const n = body.open?.[String(level) as keyof typeof body.open] ?? 0;
    if (n !== 0) open[level] = n;
  }

  const night = await nightCeiling(body, product);
  if (!night.ok) return night.res;
  const { stillOut } = night;

  // A spill moves no stock (it left at checkout): the quantity goes in its own column.
  const spilledQty = body.kind === "WASTE" ? (body.spilledQty ?? 0) : 0;
  const level = body.level ?? 0;
  if (body.kind === "WASTE") {
    if (spilledQty <= 0) return fail(422, "stock.nothingSpilled");
    // Compared in the product's own unit (millilitres for bottles).
    const lost = spillVolume(product, { kind: "WASTE", units: 0, spilledQty, level });
    if (lost > stillOut) return fail(422, "stock.moreThanWentOut");
    units = 0;
    for (const level of LEVELS) delete open[level];
  }

  // A homecoming cannot bring back more than the night is still missing.
  if (body.kind === "RETURN") {
    const coming = movementVolume(product, { kind: "RETURN", units, open });
    if (coming > stillOut) return fail(422, "stock.moreThanWentOut");
  }

  const takesOut = units < 0 || LEVELS.some((l) => (open[l] ?? 0) < 0);
  if (takesOut) {
    const pick = {
      sealed: Math.max(0, -units),
      open: Object.fromEntries(
        LEVELS.map((l) => [l, Math.max(0, -(open[l] ?? 0))]).filter(([, n]) => (n as number) > 0),
      ) as OpenBottles,
    };
    // A write-off is not a choice, so the ladder has no say. Everything else is picked, dregs first.
    const bad =
      body.kind === "SPOILAGE"
        ? shortfall({ sealed: held.units, open: held.open }, pick)
        : pickFault({ sealed: held.units, open: held.open }, pick);
    if (bad) return fail(422, `stock.${bad}`);
  }

  const movement: ProposedEntry = {
    kind: body.kind,
    units,
    open,
    spilledQty,
    correctsId: body.correctsId ?? null,
  };
  // The same rule the form applies, so the two cannot disagree.
  const fault = entryFault(movement, product);
  if (fault) return fail(422, `stock.${fault}`);

  // A purchase brings what was paid. Anything leaving costs the moving average now, never
  // recomputed (lib/stock/value.ts).
  const valueDeltaOre = valueDelta(
    { qty: costBasis({ units: held.units }), valueOre: held.valueOre },
    // The price now, which the row also captures.
    { kind: body.kind, units, unitCostOre: product.costPriceOre },
  );

  // The rows this one may name, looked up together. Null when not named.
  const [target, expense] = await Promise.all([
    body.correctsId
      ? prisma.stockEntry.findUnique({
          where: { id: body.correctsId },
          select: { productId: true },
        })
      : null,
    body.expenseId
      ? prisma.expense.findUnique({ where: { id: body.expenseId }, select: { id: true } })
      : null,
  ]);
  if (body.correctsId) {
    if (!target) return fail(422, "stock.correctionTargetNotFound");
    if (target.productId !== product.id) return fail(422, "stock.correctionWrongProduct");
  }
  if (body.expenseId && !expense) return fail(422, "stock.expenseNotFound");

  // Only a delivery brings stock in with an age. A return is as old as its delivery.
  const bestBeforeAt =
    body.kind === "PURCHASE" ? bestBeforeOf(body.occurredAt, product.shelfLifeMonths) : null;

  // Recorded as something somebody did, for the product's feed (a delivery has no event).
  const entry = await prisma.stockEntry.create({
    data: {
      productId: product.id,
      kind: body.kind,
      units,
      ...openColumns(open),
      valueDeltaOre,
      // The price now, captured so re-pricing cannot move it.
      unitCostOre: product.costPriceOre,
      // On a delivery, also the shelf life, captured for the same reason (lib/stock/expiry.ts).
      // Null on other kinds.
      bestBefore: bestBeforeAt ? new Date(bestBeforeAt) : null,
      spilledQty,
      level,
      eventId: body.eventId ?? null,
      occurredAt: new Date(body.occurredAt),
      actorId: g.actor.id,
      expenseId: body.expenseId ?? null,
      correctsId: body.correctsId ?? null,
      note: body.note ?? null,
    },
    select: { id: true },
  });

  // The figure typed at the rung the row is about. A spill carries its own count; otherwise the
  // shelf columns' move, which for an opened bottle is the rung rather than `units`.
  const movedQty =
    body.kind === "WASTE" ? spilledQty : Math.abs(isLevel(level) ? (open[level] ?? 0) : units);

  await prisma.stockChange.create({
    data: {
      entryId: entry.id,
      productId: product.id,
      eventId: body.eventId ?? null,
      action: "CREATE",
      kind: body.kind,
      level,
      toQty: movedQty,
      actorId: g.actor.id,
    },
  });

  // A delivery dated before existing rows changes their cost, and a row before a count changes its difference.
  await bulkTransaction(async (tx) => replayProduct(tx, product.id));

  return NextResponse.json({ id: entry.id }, { status: 201 });
}
