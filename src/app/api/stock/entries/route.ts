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
import { LEVELS, pickFault, type OpenBottles } from "@/lib/stock/levels";
import { movementVolume, spillVolume, tagTotals, unaccounted } from "@/lib/stock/tag";
import { onHand } from "@/lib/stock/onhand";
import { costBasis, valueDelta } from "@/lib/stock/value";
import { replayProduct } from "@/lib/server/stock-replay";
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
    },
  });
  if (!product) return fail(404, "stock.productNotFound");

  // What the log already says this product holds. Needed twice below: to turn a
  // weighing into a movement, and to price whatever is leaving.
  const sums = await prisma.stockEntry.aggregate({
    where: { productId: product.id },
    _sum: {
      units: true,
      open80: true,
      open60: true,
      open40: true,
      open20: true,
      valueDeltaOre: true,
    },
  });
  const held = onHand(product, [
    {
      kind: "COUNT",
      units: sums._sum.units ?? 0,
      open: {
        80: sums._sum.open80 ?? 0,
        60: sums._sum.open60 ?? 0,
        40: sums._sum.open40 ?? 0,
        20: sums._sum.open20 ?? 0,
      },
      valueDeltaOre: sums._sum.valueDeltaOre ?? 0,
    },
  ]);

  // ── The bottles ──
  //
  // A level is never re-estimated on the way out: the body picks bottles that
  // are already on a rung, and the shelf has to actually have them. `pickFault`
  // is where the bar's rule lives — the open ones leave before a sealed one
  // does — and it is the same function the form asks before offering the
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
  // anything before the count changes — which is what makes a count a baseline
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

    const made = await prisma.$transaction(async (tx) => {
      const ids: string[] = [];
      for (const w of wanted) {
        const row = await tx.stockEntry.create({
          data: {
            productId: product.id,
            kind: "COUNT",
            level: w.level,
            countedQty: w.qty,
            occurredAt: new Date(body.occurredAt),
            actorId: g.actor.id,
            note: body.note ?? null,
          },
          select: { id: true },
        });
        ids.push(row.id);
        await tx.stockChange.create({
          data: {
            entryId: row.id,
            productId: product.id,
            action: "CREATE",
            kind: "COUNT",
            level: w.level,
            toQty: w.qty,
            actorId: g.actor.id,
          },
        });
      }
      await replayProduct(tx, product.id, product.costPriceOre);
      return ids;
    });
    return NextResponse.json({ id: made[0] }, { status: 201 });
  }

  // ── The occasion ──
  //
  // The three kinds that make up a night must name one. A movement of stock to
  // or from a bar that belongs to no night is a row nothing can ever reconcile:
  // a pub running past midnight is two dates and a committee may take stock out
  // twice in an evening, so nothing but an explicit tag says which rows go
  // together.
  const TAGGED: StockEntryKind[] = ["CHECKOUT", "RETURN", "WASTE"];
  if (TAGGED.includes(body.kind)) {
    if (!body.tagId) return fail(422, "stock.tagRequired");
    const tag = await prisma.stockTag.findUnique({
      where: { id: body.tagId },
      select: { id: true },
    });
    if (!tag) return fail(422, "stock.tagNotFound");
  } else if (body.tagId) {
    // A delivery and a stocktake are about the cellar rather than a night, and
    // letting one carry a tag would put stock into a night's arithmetic that
    // never went to it.
    return fail(422, "stock.tagOnNightOnly");
  }

  // What this tag has already moved of this product, which is the ceiling on
  // anything coming back or being written off against it.
  let stillOut = 0;
  if (body.tagId) {
    const booked = await prisma.stockEntry.findMany({
      where: { tagId: body.tagId, productId: product.id },
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
          open: { 80: b.open80, 60: b.open60, 40: b.open40, 20: b.open20 },
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
    const bad = pickFault({ sealed: held.units, open: held.open }, pick);
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
  // at this moment — computed here and never recomputed, because the average
  // moves with the next delivery and a figure worked out later would not be
  // what this movement was worth. See lib/stock/value.ts.
  const valueDeltaOre = valueDelta(
    { qty: costBasis({ units: held.units }), valueOre: held.valueOre },
    { kind: body.kind, units, costPriceOre: product.costPriceOre },
  );

  if (body.lotId) {
    const lot = await prisma.stockLot.findUnique({
      where: { id: body.lotId },
      select: { productId: true },
    });
    if (!lot) return fail(422, "stock.lotNotFound");
    // A lot belongs to one product; crediting a return back to another
    // product's delivery would carry that delivery's best-before with it.
    if (lot.productId !== product.id) return fail(422, "stock.lotWrongProduct");
  }
  if (body.correctsId) {
    const target = await prisma.stockEntry.findUnique({
      where: { id: body.correctsId },
      select: { productId: true },
    });
    if (!target) return fail(422, "stock.correctionTargetNotFound");
    if (target.productId !== product.id) return fail(422, "stock.correctionWrongProduct");
  }
  if (body.expenseId) {
    const expense = await prisma.expense.findUnique({
      where: { id: body.expenseId },
      select: { id: true },
    });
    if (!expense) return fail(422, "stock.expenseNotFound");
  }

  // Recorded as something somebody did, not only as something that happened.
  // The product's own feed is where "why does Fireball say 20?" gets answered,
  // and a delivery has no occasion to ask it from.
  const entry = await prisma.stockEntry.create({
    data: {
      productId: product.id,
      kind: body.kind,
      units,
      open80: open[80] ?? 0,
      open60: open[60] ?? 0,
      open40: open[40] ?? 0,
      open20: open[20] ?? 0,
      valueDeltaOre,
      spilledQty,
      level,
      tagId: body.tagId ?? null,
      occurredAt: new Date(body.occurredAt),
      actorId: g.actor.id,
      lotId: body.lotId ?? null,
      expenseId: body.expenseId ?? null,
      correctsId: body.correctsId ?? null,
      note: body.note ?? null,
    },
    select: { id: true },
  });

  await prisma.stockChange.create({
    data: {
      entryId: entry.id,
      productId: product.id,
      tagId: body.tagId ?? null,
      action: "CREATE",
      kind: body.kind,
      level,
      toQty: body.kind === "WASTE" ? spilledQty : Math.abs(units),
      actorId: g.actor.id,
    },
  });

  // A delivery dated before rows that already exist changes what they cost, and
  // any row before a count changes what the count's difference has to be.
  await prisma.$transaction(async (tx) => replayProduct(tx, product.id, product.costPriceOre));

  return NextResponse.json({ id: entry.id }, { status: 201 });
}
