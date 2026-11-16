import "server-only";

// Period figures over the same movement log the list reads (shelf value is the sum of movements, no snapshot
// table). Pricing: lib/stock/value.ts.
import { prisma } from "@/lib/server/db";
import { getStockGroups, getStockLevels, type StockLevelDto } from "./stock";
import type { DrinkCategory, StockEntryKind } from "@/lib/domain/types";
import { hasTag } from "@/lib/stock/tags";
import { stockholmDay, today } from "@/lib/domain/date";
import type { StockSlug } from "@/lib/stock/stocks";

/** What the screen narrowed itself to. Nothing set means the whole shelf, all of time. */
interface StockStatsQuery {
  stock: StockSlug;
  /** Inclusive, `YYYY-MM-DD`. Absent means "since the first movement". */
  from?: string;
  /** Inclusive. Absent means today. */
  to?: string;
  /** Product types, by group id. */
  groups?: string[];
  tags?: string[];
}

export interface ValuePoint {
  date: string;
  /** Öre, cumulative, one per product type (group id). Zero where that type held nothing. */
  byGroup: Record<string, number>;
  totalOre: number;
}

/** A product type, as the charts name and colour it. */
export interface StatsGroup {
  id: string;
  name: string;
  /** The drink type it stands for, where it stands for one: what gives it its familiar colour. */
  category?: DrinkCategory;
}

interface GroupHolding {
  groupId: string;
  valueOre: number;
  units: number;
  /** Null when nobody has said how much a unit holds. */
  litres: number | null;
  products: number;
}

interface PeriodFlow {
  purchasedOre: number;
  /**
   * Checkouts net of returns (a checkout is a crate carried to a bar, half comes home unopened).
   * Spill is excluded: the four figures divide the period between them.
   */
  consumedOre: number;
  /**
   * Stock destroyed at a pub plus in the cellar. Only the cellar half carries a figure: a pub spill was
   * already taken off the shelf and charged at checkout, so pricing it again would charge twice (see `consumedOre`).
   */
  wastedOre: number;
  /**
   * Net shelf change from stocktakes (COUNT, a physical finding) and corrections (CORRECTION, a fix to an
   * earlier entry), kept together so the four figures divide the period. Labelled "justeringar".
   */
  adjustmentOre: number;
}

interface ProductMover {
  id: string;
  name: string;
  groupId: string;
  /** Öre that left the shelf through this product in the period and did not come back, positive. */
  outOre: number;
  valueOre: number;
}

export interface StockStats {
  /** The stock's product types, in the order every chart stacks and lists them. */
  groups: StatsGroup[];
  points: ValuePoint[];
  holdings: GroupHolding[];
  flow: PeriodFlow;
  movers: ProductMover[];
  /** Every tag any product carries, not only those surviving the filter, or narrowing would leave nothing to widen with. */
  tags: string[];
  /** The whole shelf, whatever the filter says. */
  wholeShelfOre: number;
}

/** The calendar day a movement belongs to, in Stockholm, not UTC (UTC "now" is yesterday for two hours of every Swedish evening; lib/domain/date.ts). */
const day = (d: Date): string => stockholmDay.format(d);

/**
 * Stock destroyed anywhere. Only SPOILAGE brings a value: a WASTE's cost left at the checkout that
 * carried it out, so counting it again would charge the section twice.
 */
const destroyed = (kind: StockEntryKind): boolean => kind === "WASTE" || kind === "SPOILAGE";

/**
 * What a movement takes off the shelf for good, positive. A return adds back (out and home again is net
 * nothing). `withSpill` includes spill, for a product's own line; the screen's four figures must not overlap.
 */
const gone = (kind: StockEntryKind, valueDeltaOre: number, withSpill: boolean): number =>
  kind === "CHECKOUT" ||
  kind === "RETURN" ||
  kind === "ISSUE" ||
  kind === "WITHDRAWAL" ||
  (withSpill && destroyed(kind))
    ? -valueDeltaOre
    : 0;

/** Everything the statistics page shows, in two queries. The series emits a point on each day something happened. */
export async function getStockStats(q: StockStatsQuery): Promise<StockStats> {
  const to = q.to || today();
  const [levels, groupRows] = await Promise.all([
    getStockLevels(q.stock, to),
    getStockGroups(q.stock),
  ]);
  const groups: StatsGroup[] = groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    category: g.category ?? undefined,
  }));
  const zero = (): Record<string, number> => Object.fromEntries(groups.map((g) => [g.id, 0]));

  const chosen = (p: StockLevelDto): boolean =>
    (!q.groups?.length || q.groups.includes(p.groupId)) &&
    (!q.tags?.length || q.tags.some((tag) => hasTag(p.tags, tag)));

  const kept = levels.filter(chosen);
  const keptIds = new Set(kept.map((p) => p.id));
  const groupOf = new Map(kept.map((p) => [p.id, p.groupId]));

  // Every movement up to the end of the period, before `from` as well as after: the opening value is everything earlier.
  const entries = keptIds.size
    ? await prisma.stockEntry.findMany({
        where: { productId: { in: [...keptIds] }, occurredAt: { lte: new Date(to) } },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        select: { productId: true, kind: true, valueDeltaOre: true, occurredAt: true },
      })
    : [];

  const running = zero();
  const flow: PeriodFlow = { purchasedOre: 0, consumedOre: 0, wastedOre: 0, adjustmentOre: 0 };
  const out = new Map<string, number>();

  /** End-of-day shelf value on each day something happened, and the value going into the window. */
  const closes = new Map<string, Record<string, number>>();
  let opening = zero();

  for (const e of entries) {
    const group = groupOf.get(e.productId);
    if (!group) continue;
    const date = day(e.occurredAt);
    if (q.from && date < q.from) {
      running[group] += e.valueDeltaOre;
      opening = { ...running };
      continue;
    }

    running[group] += e.valueDeltaOre;
    closes.set(date, { ...running });

    if (e.kind === "PURCHASE") flow.purchasedOre += e.valueDeltaOre;
    else if (e.kind === "COUNT" || e.kind === "CORRECTION") flow.adjustmentOre += e.valueDeltaOre;
    else if (destroyed(e.kind)) flow.wastedOre += -e.valueDeltaOre;
    flow.consumedOre += gone(e.kind, e.valueDeltaOre, false);

    const left = gone(e.kind, e.valueDeltaOre, true);
    if (left !== 0) out.set(e.productId, (out.get(e.productId) ?? 0) + left);
  }

  /**
   * A point per calendar day, carrying the last close forward (skipping idle days distorts the date spacing).
   * Long periods are sampled every nth day, always keeping the last, to bound the payload.
   */
  const first = q.from ?? [...closes.keys()][0] ?? to;
  const points: ValuePoint[] = [];
  const cursor = new Date(`${first}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);
  const days = Math.max(1, Math.round((end.getTime() - cursor.getTime()) / 86_400_000) + 1);
  const every = Math.ceil(days / 420);
  let carried = opening;
  for (let i = 0; i < days; i++) {
    const date = day(cursor);
    carried = closes.get(date) ?? carried;
    if (i % every === 0 || i === days - 1) {
      const byGroup = { ...carried };
      points.push({
        date,
        byGroup,
        totalOre: groups.reduce((sum, g) => sum + (byGroup[g.id] ?? 0), 0),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const holdings: GroupHolding[] = groups.map((group) => {
    const rows = kept.filter((p) => p.groupId === group.id);
    const litres = rows.reduce<number | null>(
      (sum, p) => (sum == null || p.onHand.totalMl == null ? null : sum + p.onHand.totalMl / 1000),
      0,
    );
    return {
      groupId: group.id,
      valueOre: rows.reduce((sum, p) => sum + p.onHand.valueOre, 0),
      units: rows.reduce((sum, p) => sum + p.onHand.units, 0),
      litres,
      products: rows.length,
    };
  });

  const movers: ProductMover[] = kept
    .map((p) => ({
      id: p.id,
      name: p.name,
      groupId: p.groupId,
      outOre: out.get(p.id) ?? 0,
      valueOre: p.onHand.valueOre,
    }))
    // More came home than went out is a mistake elsewhere, not produced stock: it does not rank.
    .filter((m) => m.outOre > 0 || m.valueOre > 0)
    .sort((a, b) => b.outOre - a.outOre || b.valueOre - a.valueOre)
    .slice(0, 8);

  return {
    groups,
    points,
    holdings,
    flow,
    movers,
    tags: [...new Set(levels.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, "sv")),
    wholeShelfOre: levels.reduce((sum, p) => sum + p.onHand.valueOre, 0),
  };
}
