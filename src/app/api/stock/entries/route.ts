// Write to the log, and read it back.
//
// POST only. There is no PATCH and no DELETE on a stock entry anywhere in this
// app, and their absence is the feature: a lagerbokföring whose rows can be
// changed after the fact is a record nobody can defend under inspection. A
// mistake is corrected by a new row naming the row it corrects.
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
  // Repeated or comma-separated, the same as the screen writes them.
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

export async function POST(req: Request) {
  const g = await gate(canManageStock, "stock.noAccess");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, CreateStockEntry);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;

  const product = await prisma.stockProduct.findUnique({
    where: { id: body.productId },
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
  if (!product) return fail(404, "stock.productNotFound");

  // What the log already says this product holds. Needed twice below: to turn a
  // weighing into a movement, and to price whatever is leaving, which is what
  // `withValue` is for.
  const held = await heldOnHand(prisma, product, { withValue: true });

  // ── The bottles ──
  //
  // A level is never re-estimated on the way out: the body picks bottles that
  // are already on a rung, and the shelf has to actually have them. `pickFault`
  // is where the bar's rule lives: the open ones leave before a sealed one
  // does, and it is the same function the form asks before offering the
  // button.
  let units = body.units ?? 0;
  const open: OpenBottles = {};
  for (const level of LEVELS) {
    const n = body.open?.[String(level) as keyof typeof body.open] ?? 0;
    if (n !== 0) open[level] = n;
  }

  // ── A stocktake ──
  //
  // What it states is what is on the shelf, so that is what is stored: a row
  // per rung holding the counted figure. The difference from what the books
  // expected is left to the replay, which works it out again every time
  // anything before the count changes, which is what makes a count a baseline
  // rather than an adjustment that quietly expires. See lib/stock/replay.ts.
  if (body.counted) {
    if (body.kind !== "COUNT") return fail(422, "stock.countedOnStocktakeOnly");
    const wanted = [
      { level: 0, qty: body.counted.sealed },
      ...LEVELS.map((level) => ({
        level: level as number,
        qty: body.counted?.open?.[String(level) as "80"] ?? 0,
      })),
    ].filter((w) => product.kind === "VOLUME" || w.level === 0);

    // Two statements rather than ten. A stocktake of a VOLUME product is five
    // rungs, each of which was its own entry insert followed by its own change
    // insert, in sequence, inside the transaction.
    const made = await bulkTransaction(async (tx) => {
      const rows = await tx.stockEntry.createManyAndReturn({
        data: wanted.map((w) => ({
          productId: product.id,
          kind: "COUNT" as const,
          level: w.level,
          countedQty: w.qty,
          // What the product costs today, kept on the row. A stocktake that
          // finds stock the log had lost is worth what that stock cost, and
          // that has to stay what it was when a price is corrected later.
          unitCostOre: product.costPriceOre,
          occurredAt: new Date(body.occurredAt),
          actorId: g.actor.id,
          note: body.note ?? null,
        })),
        select: { id: true },
      });
      // In the order given, which is what pairs each row with its rung.
      await tx.stockChange.createMany({
        data: rows.map((row, i) => ({
          entryId: row.id,
          productId: product.id,
          action: "CREATE" as const,
          kind: "COUNT" as const,
          level: wanted[i].level,
          toQty: wanted[i].qty,
          actorId: g.actor.id,
        })),
      });
      await replayProduct(tx, product.id);
      return rows.map((r) => r.id);
    });
    return NextResponse.json({ id: made[0] }, { status: 201 });
  }

  // ── The event ──
  //
  // The three kinds that make up a night must name one. A movement of stock to
  // or from a bar that belongs to no night is a row nothing can ever reconcile:
  // a pub running past midnight is two dates and a committee may take stock out
  // twice in an evening, so nothing but an explicit event says which rows go
  // together.
  const NEEDS_EVENT: StockEntryKind[] = ["CHECKOUT", "RETURN", "WASTE"];
  if (NEEDS_EVENT.includes(body.kind)) {
    if (!body.eventId) return fail(422, "stock.eventRequired");
    const event = await prisma.stockEvent.findUnique({
      where: { id: body.eventId },
      select: { id: true },
    });
    if (!event) return fail(422, "stock.eventNotFound");
  } else if (body.eventId) {
    // A delivery, a stocktake and a cellar write-off are about the cellar
    // rather than a night, and letting one carry an event would put stock into
    // a night's arithmetic that never went to it. A SPOILAGE especially: it
    // takes stock off the shelf, and against an event that had already checked
    // that stock out it would take the same bottle away twice.
    return fail(422, "stock.eventOnNightOnly");
  }

  // What this event has already moved of this product, which is the ceiling on
  // anything coming back or being written off against it.
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

  // ── A spill moves no stock ──
  //
  // What was dropped had already left the cellar when it was checked out, so
  // taking it off the shelf again would remove it twice and the crate would
  // come up short at the next stocktake. The quantity goes in its own column
  // and the shelf columns stay at nothing.
  const spilledQty = body.kind === "WASTE" ? (body.spilledQty ?? 0) : 0;
  const level = body.level ?? 0;
  if (body.kind === "WASTE") {
    if (spilledQty <= 0) return fail(422, "stock.nothingSpilled");
    // Compared in the product's own unit: the figure above is a count of
    // bottles, and what the night is missing is millilitres of them.
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
    // A write-off is not a choice, so the ladder has no say in it. Somebody
    // dropped the bottle they dropped, and refusing to record a sealed one
    // because an open one is still standing on the shelf would be asking them
    // to write down a different accident. Everything else is stock being
    // picked, and there the dregs go first. See lib/stock/levels.ts.
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
  // The same rule the form applies before offering the button, so the two can
  // never disagree about what a movement is.
  const fault = entryFault(movement, product);
  if (fault) return fail(422, `stock.${fault}`);

  // ── What it does to the value ──
  //
  // A purchase brings what was paid. Anything leaving costs the moving average
  // at this moment, computed here and never recomputed, because the average
  // moves with the next delivery and a figure worked out later would not be
  // what this movement was worth. See lib/stock/value.ts.
  const valueDeltaOre = valueDelta(
    { qty: costBasis({ units: held.units }), valueOre: held.valueOre },
    // The price as it stands now, which is also what the row is about to
    // capture: from here on the two are the same figure and neither can be
    // moved by re-pricing the product.
    { kind: body.kind, units, unitCostOre: product.costPriceOre },
  );

  // The two rows this one may name. Looked up together: they are independent
  // questions, and asking them in sequence made the second wait on the first
  // for no reason. Both resolve to null when the body did not name one.
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

  // Only a delivery brings stock into the building with an age. A return is
  // stock coming back from a night out, and it is already as old as whatever
  // delivery carried it in.
  const bestBeforeAt =
    body.kind === "PURCHASE" ? bestBeforeOf(body.occurredAt, product.shelfLifeMonths) : null;

  // Recorded as something somebody did, not only as something that happened.
  // The product's own feed is where "why does Fireball say 20?" gets answered,
  // and a delivery has no event to ask it from.
  const entry = await prisma.stockEntry.create({
    data: {
      productId: product.id,
      kind: body.kind,
      units,
      ...openColumns(open),
      valueDeltaOre,
      // The price as it stands now, captured so that nothing computed from it
      // can move when the product is re-priced. See the schema note.
      unitCostOre: product.costPriceOre,
      // And, on a delivery, roughly how long what just arrived keeps. Captured
      // for the same reason and at the same moment: it is a fact about the day
      // the stock came in, and correcting a product's shelf life afterwards
      // must change what the next delivery is watched for rather than reach
      // back into one somebody has already been out to check. Null on every
      // other kind, and on a product nobody has given a shelf life. See
      // lib/stock/expiry.ts.
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

  // The figure somebody typed, at the rung the row is about. A spill carries
  // its own count; everything else is what the shelf columns moved, and for a
  // row about an opened bottle that is the rung rather than `units`, which is
  // nought on one. A feed that logged those as nothing would be a feed that
  // lost the movement it exists to explain.
  const movedQty =
    body.kind === "WASTE"
      ? spilledQty
      : Math.abs(isLevel(level) ? (open[level] ?? 0) : units);

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

  // A delivery dated before rows that already exist changes what they cost, and
  // any row before a count changes what the count's difference has to be.
  await bulkTransaction(async (tx) => replayProduct(tx, product.id));

  return NextResponse.json({ id: entry.id }, { status: 201 });
}
