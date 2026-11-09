import "server-only";

// Period figures over the same movement log the list reads (shelf value is the sum of movements, no snapshot
// table). Pricing: lib/stock/value.ts.
import { prisma } from "@/lib/server/db";
import { getStockLevels, type StockLevelDto } from "./stock";
import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory, StockEntryKind } from "@/lib/domain/types";
import { hasTag } from "@/lib/stock/tags";
import { stockholmDay, today } from "@/lib/domain/date";

/** What the screen narrowed itself to. Nothing set means the whole shelf, all of time. */
interface StockStatsQuery {
  /** Inclusive, `YYYY-MM-DD`. Absent means "since the first movement". */
  from?: string;
  /** Inclusive. Absent means today. */
  to?: string;
  categories?: DrinkCategory[];
  tags?: string[];
}

export interface ValuePoint {
  date: string;
  /** Öre, cumulative, one per drink type. Zero where that type held nothing. */
  byCategory: Record<DrinkCategory, number>;
  totalOre: number;
}

interface CategoryHolding {
  category: DrinkCategory;
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
  category: DrinkCategory;
  /** Öre that left the shelf through this product in the period and did not come back, positive. */
  outOre: number;
  valueOre: number;
}

export interface StockStats {
  points: ValuePoint[];
  holdings: CategoryHolding[];
  flow: PeriodFlow;
  movers: ProductMover[];
  /** Every tag any product carries, not only those surviving the filter, or narrowing would leave nothing to widen with. */
  tags: string[];
  /** The whole shelf, whatever the filter says. */
  wholeShelfOre: number;
}

const zero = (): Record<DrinkCategory, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<DrinkCategory, number>;

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
  kind === "CHECKOUT" || kind === "RETURN" || (withSpill && destroyed(kind)) ? -valueDeltaOre : 0;

/** Everything the statistics page shows, in two queries. The series emits a point on each day something happened. */
export async function getStockStats(q: StockStatsQuery = {}): Promise<StockStats> {
  const to = q.to || today();
  const levels = await getStockLevels(to);

  const chosen = (p: StockLevelDto): boolean =>
    (!q.categories?.length || q.categories.includes(p.category)) &&
    (!q.tags?.length || q.tags.some((tag) => hasTag(p.tags, tag)));

  const kept = levels.filter(chosen);
  const keptIds = new Set(kept.map((p) => p.id));
  const categoryOf = new Map(kept.map((p) => [p.id, p.category]));

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
  const closes = new Map<string, Record<DrinkCategory, number>>();
  let opening = zero();

  for (const e of entries) {
    const category = categoryOf.get(e.productId);
    if (!category) continue;
    const date = day(e.occurredAt);
    if (q.from && date < q.from) {
      running[category] += e.valueDeltaOre;
      opening = { ...running };
      continue;
    }

    running[category] += e.valueDeltaOre;
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
      const byCategory = { ...carried };
      points.push({
        date,
        byCategory,
        totalOre: CATEGORIES.reduce((sum, c) => sum + byCategory[c], 0),
      });
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const holdings: CategoryHolding[] = CATEGORIES.map((category) => {
    const rows = kept.filter((p) => p.category === category);
    const litres = rows.reduce<number | null>(
      (sum, p) => (sum == null || p.onHand.totalMl == null ? null : sum + p.onHand.totalMl / 1000),
      0,
    );
    return {
      category,
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
      category: p.category,
      outOre: out.get(p.id) ?? 0,
      valueOre: p.onHand.valueOre,
    }))
    // More came home than went out is a mistake elsewhere, not produced stock: it does not rank.
    .filter((m) => m.outOre > 0 || m.valueOre > 0)
    .sort((a, b) => b.outOre - a.outOre || b.valueOre - a.valueOre)
    .slice(0, 8);

  return {
    points,
    holdings,
    flow,
    movers,
    tags: [...new Set(levels.flatMap((p) => p.tags))].sort((a, b) => a.localeCompare(b, "sv")),
    wholeShelfOre: levels.reduce((sum, p) => sum + p.onHand.valueOre, 0),
  };
}
