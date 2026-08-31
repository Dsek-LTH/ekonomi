// Reading the stock: the products, the shelf, and the log.
//
// The shelf is not a column. It is `SUM()` over the log, because the log is the
// record and anything kept beside it could disagree with it. See
// lib/stock/onhand.ts. The grouped aggregate does the replay in Postgres so a
// year of movements never crosses the wire to be added up in Node.
import "server-only";

import { prisma } from "@/lib/server/db";
import { impossible, onHand, type OnHand } from "@/lib/stock/onhand";
import { tagTotals, type TagMovement } from "@/lib/stock/event";
import { cellQty, cellTotals, type CellKind, type CellRow } from "@/lib/stock/cells";
import type { DrinkCategory, StockEntryKind, StockKind } from "@/lib/domain/types";

export interface StockProductDto {
  id: string;
  name: string;
  kind: StockKind;
  category: DrinkCategory;
  /** Per cent. Decimal in the column; a number everywhere a person sees it. */
  abv?: number;
  unitMl?: number;
  nominalMl?: number;
  costPriceOre?: number;
  ean?: string;
  /** Systembolaget's article number. See lib/stock/systembolaget.ts. */
  systembolagetId?: string;
  /** Free labels, cleaned and sorted. Always a list, empty when the product
   *  carries none: an absent array would be a second way of saying that, and
   *  every reader would have to know both. See lib/stock/tags.ts. */
  tags: string[];
}

/** A product with what is on the shelf, which is the only way a screen wants it. */
export interface StockLevelDto extends StockProductDto {
  onHand: OnHand;
  /** Stock that cannot be: negative, or liquid with no bottle. Always a
   *  bookkeeping fault rather than a fact; the overview says so. */
  impossible: boolean;
}

/** One movement of a night, inside a log line that stands for several. */
const day = (d: Date): string => d.toISOString().slice(0, 10);

/** Null becomes absent. A DTO field that is not there reads better than one
 *  that is there holding nothing. */
const opt = <T,>(v: T | null): T | undefined => v ?? undefined;

/** Every product the bar keeps. There is no second kind. */
export async function getStockProducts(): Promise<StockProductDto[]> {
  const rows = await prisma.stockProduct.findMany({
    orderBy: [{ name: "asc" }],
    select: {
      id: true,
      name: true,
      kind: true,
      category: true,
      abv: true,
      unitMl: true,
      nominalMl: true,
      costPriceOre: true,
      ean: true,
      systembolagetId: true,
      tags: true,
    },
  });
  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    category: p.category,
    abv: p.abv == null ? undefined : Number(p.abv),
    unitMl: opt(p.unitMl),
    nominalMl: opt(p.nominalMl),
    costPriceOre: opt(p.costPriceOre),
    ean: opt(p.ean),
    systembolagetId: opt(p.systembolagetId),
    tags: p.tags,
  }));
}

/**
 * Every product with what is on the shelf of it.
 *
 * The shelf is not a column: it is `SUM()` over the log, grouped in Postgres so
 * a year of movements never crosses the wire to be added up in Node. See
 * lib/stock/onhand.ts for why nothing is stored.
 *
 * `asOf` cuts the sum off at the end of a day, which is what makes "what did we
 * hold in May" answerable at all: the same replay, stopped earlier. It reads
 * the log as it is now understood rather than as it read at the time. A
 * delivery corrected last week changes what May turns out to have held, and
 * that is the point of correcting it. What the books *said* on a day is a
 * different question, and one nothing here claims to answer.
 */
export async function getStockLevels(asOf?: string): Promise<StockLevelDto[]> {
  const upTo = asOf ? { occurredAt: { lte: new Date(asOf) } } : undefined;
  const [products, sums] = await Promise.all([
    getStockProducts(),
    prisma.stockEntry.groupBy({
      where: upTo,
      by: ["productId"],
      _sum: {
        units: true,
        open80: true,
        open60: true,
        open40: true,
        open20: true,
        valueDeltaOre: true,
      },
    }),
  ]);
  const held = new Map(sums.map((s) => [s.productId, s._sum]));
  return products.map((p) => {
    const sum = held.get(p.id);
    const state = onHand(p, [
      {
        kind: "COUNT",
        units: sum?.units ?? 0,
        open: {
          80: sum?.open80 ?? 0,
          60: sum?.open60 ?? 0,
          40: sum?.open40 ?? 0,
          20: sum?.open20 ?? 0,
        },
        valueDeltaOre: sum?.valueDeltaOre ?? 0,
      },
    ]);
    return { ...p, onHand: state, impossible: impossible(p, state) };
  });
}

export interface StockLogPartDto {
  kind: StockEntryKind;
  /** 0 for a whole thing, or the rung. */
  level: number;
  /** The cell's own figure: positive, in things. */
  qty: number;
}

/**
 * One line of the log.
 *
 * A night's worth of one product, or a single delivery or stocktake. Grouped
 * that way because the log is read at a glance and what a reader wants from it
 * is what the stock did (*Onsdagspub, Absolut Vodka, three bottles down*)
 * rather than the six rows a spirit's rungs and directions come to. What those
 * rows were is in `parts`, a chevron away.
 *
 * Who did it is deliberately not here. That question is answered by
 * `getStockChanges`, read as a feed on the event and on the product, because
 * a line covering several movements has no single author and pretending
 * otherwise was how the two readings kept colliding.
 */
export interface StockLogRowDto {
  id: string;
  productId: string;
  productName: string;
  productKind: StockKind;
  /** Set when the line is a night's worth of movements for one product. */
  eventId?: string;
  tagName?: string;
  /** Set when the line is a single delivery, stocktake or correction. */
  kind?: StockEntryKind;
  /** Signed, in whole things: what the line did to the shelf. */
  units: number;
  open: { 80: number; 60: number; 40: number; 20: number };
  /** How many things were dropped. Moves no stock. See the schema. */
  spilledQty: number;
  /** What it did to the value of the stock, in öre. */
  valueDeltaOre: number;
  /** The day it happened, and the day it was written down. Both, because the
   *  gap between them is the sort of thing an inspection asks about. */
  occurredAt: string;
  recordedAt: string;
  actorName: string;
  note?: string;
  expenseId?: string;
  expenseReference?: string;
  /** What a night's line is made of, in reading order. */
  parts?: StockLogPartDto[];
  /**
   * Whether this row is a stocktake, which is corrected by counting again.
   *
   * Everything else is its author's to change, count or no count: a count
   * states what was on the shelf on a day, and its own difference is worked out
   * again on every change, so nothing before it can move anything after it.
   */
  locked?: boolean;
}

export interface StockLogFilter {
  productIds?: string[];
  kinds?: StockEntryKind[];
  /** One event's rows, which is how an event's page links into the log. */
  eventId?: string;
  /** Inclusive, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  take?: number;
}

/**
 * The log, newest first.
 *
 * By `occurredAt` and then by `createdAt`: several movements share a date all
 * the time, a night's servings are all that Friday, and the order they were
 * written in is the only thing that distinguishes them. Without the second key
 * the list would reshuffle between two loads of the same page.
 */
export async function getStockLog(filter: StockLogFilter = {}): Promise<StockLogRowDto[]> {
  const rows = await prisma.stockEntry.findMany({
    where: {
      // Several of each, because a reader narrowing a log is usually excluding
      // rather than picking: "the two beers" or "everything except stocktakes".
      // An empty list is no filter at all, not a filter matching nothing.
      productId: filter.productIds?.length ? { in: filter.productIds } : undefined,
      kind: filter.kinds?.length ? { in: filter.kinds } : undefined,
      eventId: filter.eventId,
      occurredAt: {
        gte: filter.from ? new Date(filter.from) : undefined,
        lte: filter.to ? new Date(filter.to) : undefined,
      },
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: filter.take ?? 200,
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
      valueDeltaOre: true,
      spilledQty: true,
      countedQty: true,
      eventId: true,
      occurredAt: true,
      createdAt: true,
      note: true,
      expenseId: true,
      product: { select: { name: true, kind: true } },
      event: { select: { name: true } },
      actor: { select: { name: true } },
      expense: { select: { reference: true } },
    },
  });

  // ── One line per thing that happened ──
  //
  // A night's movements of one product are one line; a delivery or a stocktake
  // is its own. Grouped here rather than on the screen so the figures a reader
  // sees and the figures anything else computes come from the same fold.
  const lines: StockLogRowDto[] = [];
  const nights = new Map<string, StockLogRowDto>();
  // A stocktake of a spirit states a figure per rung, so it is several rows
  // saying one thing. Gathered the same way a night is, for the same reason.
  const counts = new Map<string, StockLogRowDto>();

  for (const r of rows) {
    const base = {
      productId: r.productId,
      productName: r.product.name,
      productKind: r.product.kind,
      occurredAt: day(r.occurredAt),
      recordedAt: day(r.createdAt),
      actorName: r.actor.name,
    };

    if (r.kind === "COUNT") {
      const key = `${r.productId}|${day(r.occurredAt)}`;
      let line = counts.get(key);
      if (!line) {
        line = {
          ...base,
          id: r.id,
          kind: "COUNT",
          locked: true,
          units: 0,
          open: { 80: 0, 60: 0, 40: 0, 20: 0 },
          spilledQty: 0,
          valueDeltaOre: 0,
          note: opt(r.note),
          parts: [],
        };
        counts.set(key, line);
        lines.push(line);
      }
      line.units += r.units;
      line.open[80] += r.open80;
      line.open[60] += r.open60;
      line.open[40] += r.open40;
      line.open[20] += r.open20;
      line.valueDeltaOre += r.valueDeltaOre;
      if (r.countedQty != null) {
        line.parts!.push({ kind: "COUNT", level: r.level, qty: r.countedQty });
      }
      continue;
    }

    if (!r.eventId) {
      lines.push({
        ...base,
        id: r.id,
        kind: r.kind,
        locked: false,
        units: r.units,
        open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
        spilledQty: r.spilledQty,
        valueDeltaOre: r.valueDeltaOre,
        note: opt(r.note),
        expenseId: opt(r.expenseId),
        expenseReference: opt(r.expense?.reference ?? null),
      });
      continue;
    }

    const key = `${r.eventId}|${r.productId}`;
    let line = nights.get(key);
    if (!line) {
      // Rows arrive newest first, so the first one seen is the one whose date
      // and author the line carries.
      line = {
        ...base,
        id: key,
        eventId: r.eventId,
        tagName: r.event?.name,
        units: 0,
        open: { 80: 0, 60: 0, 40: 0, 20: 0 },
        spilledQty: 0,
        valueDeltaOre: 0,
        parts: [],
      };
      nights.set(key, line);
      lines.push(line);
    }
    line.units += r.units;
    line.open[80] += r.open80;
    line.open[60] += r.open60;
    line.open[40] += r.open40;
    line.open[20] += r.open20;
    line.spilledQty += r.spilledQty;
    line.valueDeltaOre += r.valueDeltaOre;
    line.parts!.push({
      kind: r.kind,
      level: r.level,
      qty: cellQty({
        productId: r.productId,
        kind: r.kind as CellKind,
        level: r.level,
        units: r.units,
        open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
        spilledQty: r.spilledQty,
      }),
    });
  }

  // Out, then in, then spill; whole things before the ladder. The order a
  // person reads a night in, rather than the order rows were written.
  const order: Record<string, number> = { CHECKOUT: 0, RETURN: 1, WASTE: 2 };
  for (const line of nights.values()) {
    line.parts!.sort(
      (a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.level - b.level,
    );
  }
  // A count reads whole things first, then down the ladder, the order somebody
  // walks a shelf in.
  for (const line of counts.values()) line.parts!.sort((a, b) => a.level - b.level);
  return lines;
}

/** One thing somebody did to a stock row. */
export interface StockChangeDto {
  id: string;
  action: "CREATE" | "UPDATE" | "DELETE";
  productId: string;
  productName: string;
  eventId?: string;
  tagName?: string;
  kind: StockEntryKind;
  level: number;
  fromQty?: number;
  toQty?: number;
  at: string;
  actorName: string;
}

/**
 * Who did what, read either by event or by product.
 *
 * The other half of the log, and deliberately a separate one. The ledger says
 * what the stock did; this says who made it say that, including the things
 * that turned out not to have happened at all, which the ledger no longer
 * carries because they were mistakes rather than movements.
 *
 * Keyed both ways because the two questions are asked in different places. "What
 * happened at Onsdagspub" belongs on the event. "Why does Fireball say 20"
 * belongs on the product, and a delivery has no event to ask it from.
 *
 * `onlyEdits` is what keeps the product page from saying everything twice. An
 * event has no other list of its movements, so it shows the whole feed; a
 * product has one right beside this, and a creation row there is the movement
 * next to it restated. What is left is the corrections, which is the question
 * that list cannot answer.
 */
export async function getStockChanges(
  filter: { eventId?: string; productId?: string; take?: number; onlyEdits?: boolean } = {},
): Promise<StockChangeDto[]> {
  if (!filter.eventId && !filter.productId) return [];
  const rows = await prisma.stockChange.findMany({
    where: {
      eventId: filter.eventId,
      productId: filter.productId,
      // A row being made is the movement itself, said twice. Where the reader
      // already has a list of movements beside this one (the product page),
      // only what happened to them *afterwards* is new information.
      action: filter.onlyEdits ? { in: ["UPDATE", "DELETE"] } : undefined,
    },
    orderBy: { at: "desc" },
    take: filter.take ?? 100,
    select: {
      id: true,
      action: true,
      productId: true,
      eventId: true,
      kind: true,
      level: true,
      fromQty: true,
      toQty: true,
      at: true,
      product: { select: { name: true } },
      event: { select: { name: true } },
      actor: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    productId: r.productId,
    productName: r.product.name,
    eventId: opt(r.eventId),
    tagName: opt(r.event?.name ?? null),
    kind: r.kind,
    level: r.level,
    fromQty: r.fromQty ?? undefined,
    toQty: r.toQty ?? undefined,
    at: r.at.toISOString(),
    actorName: r.actor.name,
  }));
}


/**
 * What the whole stock is worth, in öre, and what it is made of.
 *
 * Summed over the log rather than over a stored balance, like everything else
 * here: the value is the sum of a column, so a total is one aggregate and
 * cannot disagree with the rows it came from.
 */
export async function getStockValueOre(): Promise<number> {
  const sum = await prisma.stockEntry.aggregate({ _sum: { valueDeltaOre: true } });
  return sum._sum.valueDeltaOre ?? 0;
}

// ── Events ──────────────────────────────────────────────────────────

export interface StockEventDto {
  id: string;
  name: string;
  date: string;
  /** How many movements have been booked on it. */
  entries: number;
  /** How many products it has touched. */
  products: number;
  /** What it sold, in öre, at the average the log carries. */
  soldValueOre: number;
  /**
   * Whether anything it took out is still unaccounted for.
   *
   * The list's one piece of judgement, and it is deliberately not a status: a
   * night with stock still out is not "open", it is a night whose sold figure
   * is counting crates that may yet come back. See `openCaveat` on the page.
   */
  unreturned: boolean;
}

/** What one product did on one event. */
export interface TagLineDto {
  productId: string;
  productName: string;
  productKind: StockKind;
  /** Millilitres for a spirit, whole units for anything else. */
  out: number;
  back: number;
  spilled: number;
  sold: number;
  /** What the sold quantity cost, in öre, at the average the log carries. */
  soldValueOre: number;
  /**
   * What each of the product's cells reads, keyed `${kind}|${level}`, the
   * grid's own coordinates, see lib/stock/cells.ts. Only cells something has
   * been booked on appear; the sheet reads a missing one as nought.
   */
  cells: Record<string, number>;
}

export interface StockEventDetailDto extends StockEventDto {
  lines: TagLineDto[];
}

/** The columns of the entry table this file needs to fold an event. */
const TAG_ENTRY = {
  kind: true,
  units: true,
  open80: true,
  open60: true,
  open40: true,
  open20: true,
  spilledQty: true,
  level: true,
} as const;

type TagRow = {
  kind: StockEntryKind;
  units: number;
  open80: number;
  open60: number;
  open40: number;
  open20: number;
  spilledQty: number;
  level: number;
};

const asMovement = (r: TagRow): TagMovement => ({
  kind: r.kind,
  units: r.units,
  open: { 80: r.open80, 60: r.open60, 40: r.open40, 20: r.open20 },
  spilledQty: r.spilledQty,
  level: r.level,
});

/**
 * What a bottle of each of these products costs, at the moving average.
 *
 * The whole log, not the event's part of it: a night's cost of goods is not a
 * different question from what the shelf is worth. See lib/stock/value.ts for
 * why the unit cost is worked out rather than stored.
 */
async function unitCosts(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const values = await prisma.stockEntry.groupBy({
    by: ["productId"],
    where: { productId: { in: productIds } },
    _sum: { units: true, valueDeltaOre: true },
  });
  return new Map(
    values.map((v) => [
      v.productId,
      (v._sum.units ?? 0) > 0 ? (v._sum.valueDeltaOre ?? 0) / (v._sum.units as number) : 0,
    ]),
  );
}

/** A spirit's sale is millilitres; its cost is per bottle. */
const soldValue = (
  product: { kind: StockKind; nominalMl?: number | null },
  sold: number,
  perUnitOre: number,
): number => {
  const whole = product.kind === "VOLUME" ? (product.nominalMl ?? 0) : 1;
  return whole > 0 ? Math.round((sold / whole) * perUnitOre) : 0;
};

/**
 * The events, most recent first.
 *
 * Recent first because the one being registered against is nearly always the
 * last one made. A pub is entered the evening it runs, or the Monday after.
 *
 * Every event's arithmetic is folded here rather than on the row that opens it,
 * so the list can say what a night sold and whether anything is still out. Two
 * queries for the whole page: the movements of every event shown, and the unit
 * cost of every product they touched.
 */
export async function getStockEvents(take = 50): Promise<StockEventDto[]> {
  const events = await prisma.stockEvent.findMany({
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take,
    select: { id: true, name: true, date: true },
  });
  if (events.length === 0) return [];

  const entries = await prisma.stockEntry.findMany({
    where: { eventId: { in: events.map((t) => t.id) } },
    select: {
      ...TAG_ENTRY,
      eventId: true,
      product: { select: { id: true, name: true, kind: true, nominalMl: true } },
    },
  });

  const costs = await unitCosts([...new Set(entries.map((e) => e.product.id))]);

  // event → product → its movements.
  const byTag = new Map<string, Map<string, typeof entries>>();
  for (const e of entries) {
    if (!e.eventId) continue;
    const products = byTag.get(e.eventId) ?? new Map();
    products.set(e.product.id, [...(products.get(e.product.id) ?? []), e]);
    byTag.set(e.eventId, products);
  }

  return events.map((event) => {
    const products = byTag.get(event.id) ?? new Map<string, typeof entries>();
    let soldValueOre = 0;
    let unreturned = false;
    let count = 0;
    for (const rows of products.values()) {
      const product = rows[0].product;
      const totals = tagTotals(product, rows.map(asMovement));
      soldValueOre += soldValue(product, totals.sold, costs.get(product.id) ?? 0);
      if (totals.out > totals.back + totals.spilled) unreturned = true;
      count += rows.length;
    }
    return {
      id: event.id,
      name: event.name,
      date: day(event.date),
      entries: count,
      products: products.size,
      soldValueOre,
      unreturned,
    };
  });
}

/**
 * One event, with what it moved per product and what each of its cells reads.
 *
 * The cells are the sheet's whole state. They are sums over the log rather than
 * anything stored. A cell is one column of the entry table scoped to a
 * product, a kind and a rung, so what the grid shows and what the ledger holds
 * cannot drift apart, and editing a cell is a difference written to the log.
 */
export async function getStockEvent(id: string): Promise<StockEventDetailDto | null> {
  const event = await prisma.stockEvent.findUnique({
    where: { id },
    select: { id: true, name: true, date: true },
  });
  if (!event) return null;

  const entries = await prisma.stockEntry.findMany({
    where: { eventId: id },
    select: {
      ...TAG_ENTRY,
      product: { select: { id: true, name: true, kind: true, unitMl: true, nominalMl: true } },
    },
  });

  const byProduct = new Map<string, typeof entries>();
  for (const e of entries) {
    byProduct.set(e.product.id, [...(byProduct.get(e.product.id) ?? []), e]);
  }
  const costs = await unitCosts([...byProduct.keys()]);

  // Every cell of the event at once, then handed out per product below. The same
  // fold the sheet's confirm goes through, so the figure somebody types against
  // is the figure the server will check them against.
  const cells = cellTotals(
    entries.map(
      (e): CellRow => ({
        productId: e.product.id,
        kind: e.kind as CellKind,
        level: e.level,
        units: e.units,
        open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 },
        spilledQty: e.spilledQty,
      }),
    ),
  );

  const lines: TagLineDto[] = [...byProduct.entries()].map(([productId, rows]) => {
    const product = rows[0].product;
    const totals = tagTotals(product, rows.map(asMovement));
    const mine: Record<string, number> = {};
    for (const [key, value] of cells) {
      if (value !== 0 && key.startsWith(`${productId}|`)) {
        mine[key.slice(productId.length + 1)] = value;
      }
    }
    return {
      productId,
      productName: product.name,
      productKind: product.kind,
      ...totals,
      soldValueOre: soldValue(product, totals.sold, costs.get(productId) ?? 0),
      cells: mine,
    };
  });
  lines.sort((a, b) => a.productName.localeCompare(b.productName, "sv"));

  return {
    id: event.id,
    name: event.name,
    date: day(event.date),
    entries: entries.length,
    products: byProduct.size,
    soldValueOre: lines.reduce((sum, l) => sum + l.soldValueOre, 0),
    unreturned: lines.some((l) => l.out > l.back + l.spilled),
    lines,
  };
}

// ── The product's own two histories ────────────────────────────────────────
//
// A product has been through two entirely different sorts of thing, and the
// page used to show them as one list because the database stores them in one
// table. They are not one question. What a product did *at nights* is a
// consumption story, naturally told per event and in the shape of the event
// sheet. What happened to it *in the cellar*, bought, counted, corrected, is
// a chronological list of deliberate acts with nothing to do with each other.
//
// Splitting them this way also settles where a correction belongs, which no
// amount of filtering one merged list ever did: a correction to a night's
// figure hangs off that night, and a correction to a delivery sits beside the
// delivery.

/** What one product did on one event, with whatever was later changed about it. */
export interface ProductEventDto {
  eventId: string;
  tagName: string;
  date: string;
  /** In the product's own unit: millilitres for a spirit, a count otherwise. */
  out: number;
  back: number;
  spilled: number;
  sold: number;
  /** Corrections made to this product's figures on this event, newest first. */
  changes: StockChangeDto[];
}

/**
 * Every event this product has any record on, newest first.
 *
 * Records, not movements. A night whose figures were entered and then removed
 * has nothing left in the ledger, correctly, since nothing happened, but
 * somebody did do that, and a row that vanished would take the only trace of it
 * with it. Such a night appears with nothing in its columns and the story
 * behind its chevron.
 */
export async function getProductEvents(productId: string): Promise<ProductEventDto[]> {
  const [entries, changes, product] = await Promise.all([
    prisma.stockEntry.findMany({
      where: { productId, eventId: { not: null } },
      select: { ...TAG_ENTRY, eventId: true, event: { select: { name: true, date: true } } },
    }),
    // Edits only. A row being created is the figure the row already shows, and
    // a chevron restating it is the duplication this split exists to end.
    getStockChanges({ productId, take: 200, onlyEdits: true }),
    prisma.stockProduct.findUnique({
      where: { id: productId },
      select: { kind: true, unitMl: true, nominalMl: true },
    }),
  ]);
  if (!product) return [];

  const named = new Map<string, { name: string; date: string }>();
  const rows = new Map<string, typeof entries>();
  for (const e of entries) {
    if (!e.eventId || !e.event) continue;
    named.set(e.eventId, { name: e.event.name, date: day(e.event.date) });
    rows.set(e.eventId, [...(rows.get(e.eventId) ?? []), e]);
  }

  const onTag = new Map<string, StockChangeDto[]>();
  for (const c of changes) {
    if (!c.eventId) continue;
    onTag.set(c.eventId, [...(onTag.get(c.eventId) ?? []), c]);
    if (!named.has(c.eventId) && c.tagName) named.set(c.eventId, { name: c.tagName, date: "" });
  }

  const out = [...named.entries()].map(([eventId, event]) => ({
    eventId,
    tagName: event.name,
    date: event.date,
    ...tagTotals(product, (rows.get(eventId) ?? []).map(asMovement)),
    changes: onTag.get(eventId) ?? [],
  }));
  // Newest night first. An event known only from a change has no date of its own
  // here, and sorts last, which is where a night nothing is booked on belongs.
  out.sort((a, b) => b.date.localeCompare(a.date) || a.tagName.localeCompare(b.tagName, "sv"));
  return out;
}

/** One thing that happened to the product in the cellar. */
export interface CellarRowDto {
  id: string;
  /** When it was written down. The order these appeared in. */
  at: string;
  /** The day it happened. Absent on a correction, which happened when it happened. */
  occurredAt?: string;
  kind: StockEntryKind;
  actorName: string;
  /** Set on a correction: what the figure was, and what it became. */
  from?: number;
  to?: number;
  /** Set on a movement: what it did to the shelf. */
  units?: number;
  open?: { 80: number; 60: number; 40: number; 20: number };
  /** On a stocktake: what was counted, per rung. */
  counted?: { level: number; qty: number }[];
  valueDeltaOre?: number;
  note?: string;
  /** Whether this page may correct it. A stocktake is corrected by counting again. */
  fixable: boolean;
}

/**
 * Deliveries, stocktakes and corrections to them, most recently written first.
 *
 * Ordered by when each was recorded rather than by the day it is about, because
 * that is the order somebody is reconstructing: a delivery entered on Monday
 * for Friday, and put right on Tuesday, reads in the order those three things
 * happened to the record.
 */
export async function getProductCellar(productId: string): Promise<CellarRowDto[]> {
  const [entries, changes] = await Promise.all([
    prisma.stockEntry.findMany({
      where: { productId, eventId: null },
      orderBy: { createdAt: "desc" },
      take: 60,
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
        occurredAt: true,
        createdAt: true,
        note: true,
        actor: { select: { name: true } },
      },
    }),
    // Edits only, for the same reason: the delivery itself is a row above.
    getStockChanges({ productId, take: 100, onlyEdits: true }),
  ]);

  const rows: CellarRowDto[] = [];

  // A stocktake states a figure per rung, so it is several rows saying one
  // thing, gathered the way the log gathers them.
  const counts = new Map<string, CellarRowDto>();
  for (const e of entries) {
    if (e.kind === "COUNT") {
      const key = day(e.occurredAt);
      let row = counts.get(key);
      if (!row) {
        row = {
          id: e.id,
          at: e.createdAt.toISOString(),
          occurredAt: key,
          kind: "COUNT",
          actorName: e.actor.name,
          units: 0,
          open: { 80: 0, 60: 0, 40: 0, 20: 0 },
          counted: [],
          valueDeltaOre: 0,
          note: opt(e.note),
          fixable: false,
        };
        counts.set(key, row);
        rows.push(row);
      }
      row.units = (row.units ?? 0) + e.units;
      row.valueDeltaOre = (row.valueDeltaOre ?? 0) + e.valueDeltaOre;
      if (e.countedQty != null) row.counted!.push({ level: e.level, qty: e.countedQty });
      continue;
    }
    rows.push({
      id: e.id,
      at: e.createdAt.toISOString(),
      occurredAt: day(e.occurredAt),
      kind: e.kind,
      actorName: e.actor.name,
      units: e.units,
      open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 },
      valueDeltaOre: e.valueDeltaOre,
      note: opt(e.note),
      // A stocktake is corrected by counting again; a night's figures belong to
      // its own sheet. What is left is the case this page is for.
      fixable: true,
    });
  }

  for (const c of changes) {
    if (c.eventId) continue;
    rows.push({
      id: c.id,
      at: c.at,
      kind: c.kind,
      actorName: c.actorName,
      from: c.fromQty ?? 0,
      to: c.toQty ?? 0,
      fixable: false,
    });
  }

  for (const row of counts.values()) row.counted!.sort((a, b) => a.level - b.level);
  rows.sort((a, b) => b.at.localeCompare(a.at));
  return rows;
}
