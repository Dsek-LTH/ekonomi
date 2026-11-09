// The shelf is `SUM()` over the log, grouped in Postgres so a year of movements never crosses the wire (lib/stock/onhand.ts).
import "server-only";

import { prisma } from "@/lib/server/db";
import { impossible, onHand, type OnHand } from "@/lib/stock/onhand";
import { tagTotals, type TagMovement } from "@/lib/stock/event";
import { cellQty, cellTotals, type CellKind, type CellRow } from "@/lib/stock/cells";
import type { DrinkCategory, StockEntryKind, StockKind } from "@/lib/domain/types";
import { checkOf, lastEmptied, soonestCheck, type Check, type ShelfStep } from "@/lib/stock/expiry";
import { OPEN_SUM, openOf } from "@/lib/server/stock-state";
import type { StockEntry } from "@/lib/generated/prisma/client";
import { today, isoDay } from "@/lib/domain/date";

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
  /** Months it keeps from delivery. Absent where unsaid and for things that do not go off (lib/stock/expiry.ts). */
  shelfLifeMonths?: number;
  ean?: string;
  /** Systembolaget's article number. See lib/stock/systembolaget.ts. */
  systembolagetId?: string;
  /** Free labels, cleaned and sorted. Always a list, never absent (lib/stock/tags.ts). */
  tags: string[];
}

export interface StockLevelDto extends StockProductDto {
  onHand: OnHand;
  /** Stock that cannot be (negative, or liquid with no bottle): a bookkeeping fault, which the overview says. */
  impossible: boolean;
}

const opt = <T>(v: T | null): T | undefined => v ?? undefined;

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
      shelfLifeMonths: true,
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
    shelfLifeMonths: opt(p.shelfLifeMonths),
    ean: opt(p.ean),
    systembolagetId: opt(p.systembolagetId),
    tags: p.tags,
  }));
}

/**
 * Every product with what is on the shelf of it. `asOf` stops the replay at the end of a day, reading the log
 * as understood now (a delivery corrected last week changes what May held), not as the books said then.
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

interface StockLogPartDto {
  kind: StockEntryKind;
  /** 0 for a whole thing, or the rung. */
  level: number;
  /** The cell's own figure: positive, in things. */
  qty: number;
}

/**
 * One line of the log: a night's worth of one product, or a single delivery or stocktake. The rows are in
 * `parts`. Who did it is not here: a line covering several movements has no single author (see `getStockChanges`).
 */
export interface StockLogRowDto {
  id: string;
  productId: string;
  productName: string;
  productKind: StockKind;
  eventId?: string;
  tagName?: string;
  kind?: StockEntryKind;
  units: number;
  open: { 80: number; 60: number; 40: number; 20: number };
  /** How many things were dropped. Moves no stock. See the schema. */
  spilledQty: number;
  valueDeltaOre: number;
  /** The day it happened and the day it was written down. */
  occurredAt: string;
  recordedAt: string;
  actorName: string;
  note?: string;
  expenseId?: string;
  expenseReference?: string;
  parts?: StockLogPartDto[];
  /**
   * Whether this row is a stocktake, corrected by counting again. Everything else is its author's to change:
   * a count's difference is recomputed on every change, so nothing before it moves anything after it.
   */
  locked?: boolean;
}

interface StockLogFilter {
  productIds?: string[];
  kinds?: StockEntryKind[];
  eventId?: string;
  /** Inclusive, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  take?: number;
}

/** The log, newest first by `occurredAt` then `createdAt` (movements share dates, so the second key keeps the order stable). */
export async function getStockLog(filter: StockLogFilter = {}): Promise<StockLogRowDto[]> {
  const rows = await prisma.stockEntry.findMany({
    where: {
      // Several of each, since narrowing a log is usually excluding. An empty list is no filter.
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

  // One line per thing that happened: a night's movements of one product, or a delivery/stocktake. Grouped
  // here so the figures shown and computed come from one fold.
  const lines: StockLogRowDto[] = [];
  const nights = new Map<string, StockLogRowDto>();
  // A spirit stocktake states a figure per rung (several rows, one thing): gathered like a night.
  const counts = new Map<string, StockLogRowDto>();

  for (const r of rows) {
    const base = {
      productId: r.productId,
      productName: r.product.name,
      productKind: r.product.kind,
      occurredAt: isoDay(r.occurredAt),
      recordedAt: isoDay(r.createdAt),
      actorName: r.actor.name,
    };

    if (r.kind === "COUNT") {
      const key = `${r.productId}|${isoDay(r.occurredAt)}`;
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
      // Rows arrive newest first, so the first seen carries the line's date and author.
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

  // Out, then in, then spill; whole things before the ladder (the order a night is read in).
  const order: Record<string, number> = { CHECKOUT: 0, RETURN: 1, WASTE: 2 };
  for (const line of nights.values()) {
    line.parts!.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.level - b.level);
  }
  // A count reads whole things first, then down the ladder (the order a shelf is walked).
  for (const line of counts.values()) line.parts!.sort((a, b) => a.level - b.level);
  return lines;
}

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
 * Who did what, read by event or by product: the other half of the log, including entries later found mistaken
 * (which the ledger no longer carries). `onlyEdits` omits creation rows, which would restate the movement list
 * beside it on the product page.
 */
export async function getStockChanges(
  filter: { eventId?: string; productId?: string; take?: number; onlyEdits?: boolean } = {},
): Promise<StockChangeDto[]> {
  if (!filter.eventId && !filter.productId) return [];
  const rows = await prisma.stockChange.findMany({
    where: {
      eventId: filter.eventId,
      productId: filter.productId,
      // A creation row restates the movement; where a movement list sits beside this one, only later edits are new.
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

export interface StockEventDto {
  id: string;
  name: string;
  date: string;
  entries: number;
  products: number;
  /** What it sold, in öre, at the average the log carries. */
  soldValueOre: number;
}

interface TagLineDto {
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
  /** Cell readings keyed `${kind}|${level}` (lib/stock/cells.ts). Only cells with bookings appear; a missing one reads as nought. */
  cells: Record<string, number>;
}

export interface StockEventDetailDto extends StockEventDto {
  lines: TagLineDto[];
}

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

/** Cost of a bottle of each product at the moving average, over the whole log (lib/stock/value.ts). */
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
 * The events, most recent first (the one being registered against is nearly always the latest). Every event's
 * arithmetic is folded here in two queries: all movements shown, and each touched product's unit cost.
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
    let count = 0;
    for (const rows of products.values()) {
      const product = rows[0].product;
      const totals = tagTotals(product, rows.map(asMovement));
      soldValueOre += soldValue(product, totals.sold, costs.get(product.id) ?? 0);
      count += rows.length;
    }
    return {
      id: event.id,
      name: event.name,
      date: isoDay(event.date),
      entries: count,
      products: products.size,
      soldValueOre,
    };
  });
}

/** One event, with what it moved per product and what each cell reads. Cells are sums over the log, never stored. */
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
      product: {
        select: { id: true, name: true, kind: true, unitMl: true, nominalMl: true },
      },
    },
  });

  const byProduct = new Map<string, typeof entries>();
  for (const e of entries) {
    byProduct.set(e.product.id, [...(byProduct.get(e.product.id) ?? []), e]);
  }
  const costs = await unitCosts([...byProduct.keys()]);

  // Every cell of the event at once, by the same fold the sheet's confirm uses, so a typed figure is checked against the same figure.
  const cells = cellTotals(
    entries.map((e): CellRow => ({
      productId: e.product.id,
      kind: e.kind as CellKind,
      level: e.level,
      units: e.units,
      open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 },
      spilledQty: e.spilledQty,
    })),
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
    date: isoDay(event.date),
    entries: entries.length,
    products: byProduct.size,
    soldValueOre: lines.reduce((sum, l) => sum + l.soldValueOre, 0),
    lines,
  };
}

// The product's own two histories: nights (consumption, per event) and the cellar (deliveries, counts,
// corrections). A correction to a night hangs off that night; one to a delivery sits beside the delivery.

export interface ProductEventDto {
  eventId: string;
  tagName: string;
  date: string;
  /** In the product's own unit: millilitres for a spirit, a count otherwise. */
  out: number;
  back: number;
  spilled: number;
  sold: number;
  changes: StockChangeDto[];
}

/**
 * Every event this product has any record on, newest first. Records, not movements: a night whose figures were
 * entered then removed has nothing in the ledger but keeps its row and story.
 */
export async function getProductEvents(productId: string): Promise<ProductEventDto[]> {
  const [entries, changes, product] = await Promise.all([
    prisma.stockEntry.findMany({
      where: { productId, eventId: { not: null } },
      select: { ...TAG_ENTRY, eventId: true, event: { select: { name: true, date: true } } },
    }),
    // Edits only: a creation row is the figure the row already shows.
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
    named.set(e.eventId, { name: e.event.name, date: isoDay(e.event.date) });
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
  // Newest night first; an event known only from a change has no date and sorts last.
  out.sort((a, b) => b.date.localeCompare(a.date) || a.tagName.localeCompare(b.tagName, "sv"));
  return out;
}

export interface CellarRowDto {
  id: string;
  at: string;
  /** The day it happened. Absent on a correction, which happened when it happened. */
  occurredAt?: string;
  kind: StockEntryKind;
  actorName: string;
  from?: number;
  to?: number;
  units?: number;
  open?: { 80: number; 60: number; 40: number; 20: number };
  /**
   * Which rung the row is about: 0 for a whole thing, or one of the four. A write-off of an opened bottle moves only
   * its rung (`units` is nought), so the correction dialog needs this.
   */
  level?: number;
  counted?: { level: number; qty: number }[];
  valueDeltaOre?: number;
  note?: string;
  /** Whether this page may correct it. A stocktake is corrected by counting again. */
  fixable: boolean;
}

/** Deliveries, stocktakes and corrections to them, by when each was recorded (the order a record is reconstructed in). */
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
    // Edits only: the delivery itself is a row above.
    getStockChanges({ productId, take: 100, onlyEdits: true }),
  ]);

  const rows: CellarRowDto[] = [];

  // A stocktake states a figure per rung: several rows, gathered like the log does.
  const counts = new Map<string, CellarRowDto>();
  for (const e of entries) {
    if (e.kind === "COUNT") {
      const key = isoDay(e.occurredAt);
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
      occurredAt: isoDay(e.occurredAt),
      kind: e.kind,
      actorName: e.actor.name,
      units: e.units,
      open: { 80: e.open80, 60: e.open60, 40: e.open40, 20: e.open20 },
      level: e.level,
      valueDeltaOre: e.valueDeltaOre,
      note: opt(e.note),
      // A stocktake is corrected by counting again; a night's figures belong to its sheet.
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

/** How many movements the log holds for one product, for the delete confirmation. */
export async function getProductMovementCount(productId: string): Promise<number> {
  return prisma.stockEntry.count({ where: { productId } });
}

/** Notice wanted before a delivery's estimated date. Null until chosen; no checks are raised until then. */
export async function getStockSettings(): Promise<{ expiryLeadDays: number | null }> {
  const row = await prisma.stockSettings.findUnique({ where: { id: "singleton" } });
  return { expiryLeadDays: row?.expiryLeadDays ?? null };
}

/**
 * Products wanting somebody to read a crate, and the delivery that is the reason: one entry per product, its oldest
 * outstanding check. The rule is pure (lib/stock/expiry.ts), so the row flag and filter count agree. Two queries
 * whatever the shelf holds; the second is over products the first named.
 */
export async function getExpiryChecks(now: string = today()): Promise<Map<string, Check> | null> {
  const { expiryLeadDays } = await getStockSettings();
  // Not chosen: no rule applies. Null, not an empty map, which would read as "nothing due".
  if (expiryLeadDays === null) return null;

  // The window the rule can fire in: anything dated beyond the lead time is not due, cheaper to ask the database.
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + expiryLeadDays);

  const deliveries = await prisma.stockEntry.findMany({
    where: { kind: "PURCHASE", bestBefore: { not: null, lte: horizon } },
    orderBy: { bestBefore: "asc" },
    select: { id: true, productId: true, occurredAt: true, bestBefore: true, checkedAt: true },
  });
  if (deliveries.length === 0) return new Map();

  const productIds = [...new Set(deliveries.map((d) => d.productId))];

  // How far back the walk must go: `checkOf` skips a delivery on or before the last bare day, so only empty days
  // at or after the oldest asked-about delivery matter. What is before the cut arrives as one summed opening balance.
  const earliest = deliveries.reduce(
    (min, d) => (d.occurredAt < min ? d.occurredAt : min),
    deliveries[0].occurredAt,
  );

  const [opening, movements] = await Promise.all([
    prisma.stockEntry.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, occurredAt: { lt: earliest } },
      _sum: OPEN_SUM,
    }),
    // Only the columns the walk reads.
    prisma.stockEntry.findMany({
      where: { productId: { in: productIds }, occurredAt: { gte: earliest } },
      orderBy: { occurredAt: "asc" },
      select: {
        productId: true,
        occurredAt: true,
        units: true,
        open80: true,
        open60: true,
        open40: true,
        open20: true,
      },
    }),
  ]);

  const held = new Map(
    opening.map((o) => {
      const open = openOf(o._sum);
      return [o.productId, (o._sum.units ?? 0) + open[80] + open[60] + open[40] + open[20]];
    }),
  );

  const steps = new Map<string, ShelfStep[]>();
  for (const m of movements) {
    const list = steps.get(m.productId) ?? [];
    list.push(asStep(m));
    steps.set(m.productId, list);
  }

  const emptied = new Map(
    productIds.map((id) => [id, lastEmptied(steps.get(id) ?? [], held.get(id) ?? 0)] as const),
  );

  const byProduct = new Map<string, Check[]>();
  for (const d of deliveries) {
    const check = checkOf(asDelivery(d), expiryLeadDays, emptied.get(d.productId) ?? null, now);
    if (check) byProduct.set(d.productId, [...(byProduct.get(d.productId) ?? []), check]);
  }

  // One per product, only where something is owed. `soonestCheck` applies that, so the row flag and the product page agree.
  const out = new Map<string, Check>();
  for (const [productId, checks] of byProduct) {
    const worst = soonestCheck(checks);
    if (worst) out.set(productId, worst);
  }
  return out;
}

/** One movement as the shelf walk reads it. Both callers of `lastEmptied` map through this so an opened bottle counts the same. */
const asStep = (m: {
  occurredAt: Date;
  units: number;
  open80: number;
  open60: number;
  open40: number;
  open20: number;
}): ShelfStep => {
  const open = openOf(m);
  return {
    occurredAt: isoDay(m.occurredAt),
    units: m.units,
    openUnits: open[80] + open[60] + open[40] + open[20],
  };
};

const asDelivery = (e: Pick<StockEntry, "id" | "occurredAt" | "bestBefore" | "checkedAt">) => ({
  id: e.id,
  occurredAt: isoDay(e.occurredAt),
  bestBefore: e.bestBefore ? isoDay(e.bestBefore) : null,
  checkedAt: e.checkedAt ? isoDay(e.checkedAt) : null,
});

/**
 * Every check one product will raise, oldest date first: overdue, coming, far off and already looked at.
 * Deliveries the shelf has been empty since are not here at all.
 */
export async function getProductChecks(
  productId: string,
  now: string = today(),
): Promise<Check[] | null> {
  const { expiryLeadDays } = await getStockSettings();
  // Not chosen: see getExpiryChecks.
  if (expiryLeadDays === null) return null;

  // No horizon: this page wants what is coming as well as what is owed.
  const deliveries = await prisma.stockEntry.findMany({
    where: { productId, kind: "PURCHASE", bestBefore: { not: null } },
    orderBy: { bestBefore: "asc" },
    select: { id: true, occurredAt: true, bestBefore: true, checkedAt: true },
  });
  if (deliveries.length === 0) return [];

  // Bounded at the oldest delivery on the page, as in `getExpiryChecks`.
  const earliest = deliveries.reduce(
    (min, d) => (d.occurredAt < min ? d.occurredAt : min),
    deliveries[0].occurredAt,
  );

  const [opening, movements] = await Promise.all([
    prisma.stockEntry.aggregate({
      where: { productId, occurredAt: { lt: earliest } },
      _sum: OPEN_SUM,
    }),
    prisma.stockEntry.findMany({
      where: { productId, occurredAt: { gte: earliest } },
      orderBy: { occurredAt: "asc" },
      select: {
        occurredAt: true,
        units: true,
        open80: true,
        open60: true,
        open40: true,
        open20: true,
      },
    }),
  ]);

  const open = openOf(opening._sum);
  const held = (opening._sum.units ?? 0) + open[80] + open[60] + open[40] + open[20];
  const emptied = lastEmptied(movements.map(asStep), held);

  return deliveries.flatMap((d) => {
    const check = checkOf(asDelivery(d), expiryLeadDays, emptied, now);
    return check ? [check] : [];
  });
}
