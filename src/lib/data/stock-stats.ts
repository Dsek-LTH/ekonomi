import "server-only";

// What the shelf has been worth, and what has moved through it.
//
// The stock list answers "what have we got, now". This answers the questions
// that only a period can: whether the cellar is growing or being drunk, what it
// is made of, and what a month cost. Everything here is derived from the same
// log the list reads, so a figure on this page and a figure on that one cannot
// disagree.
//
// Read from the ledger of deltas rather than from a snapshot table: the value
// of the shelf on a given day is the sum of every movement up to it, which is
// the definition and needs no second store to keep in step. See
// lib/stock/value.ts for how one movement is priced.
import { prisma } from "@/lib/server/db";
import { getStockLevels, type StockLevelDto } from "./stock";
import { CATEGORIES } from "@/lib/domain/categories";
import type { DrinkCategory, StockEntryKind } from "@/lib/domain/types";
import { hasTag } from "@/lib/stock/tags";
import { stockholmDay, today } from "@/lib/domain/date";

/** What the screen narrowed itself to. Everything is optional; nothing set is
 *  the whole shelf, all of time. */
interface StockStatsQuery {
  /** Inclusive, `YYYY-MM-DD`. Absent means "since the first movement". */
  from?: string;
  /** Inclusive. Absent means today. */
  to?: string;
  categories?: DrinkCategory[];
  tags?: string[];
}

/** One day the shelf's value changed, and what it stood at per drink type. */
export interface ValuePoint {
  date: string;
  /** Öre, cumulative, one per drink type. Zero where that type held nothing. */
  byCategory: Record<DrinkCategory, number>;
  totalOre: number;
}

/** What one drink type holds right now. */
interface CategoryHolding {
  category: DrinkCategory;
  valueOre: number;
  units: number;
  /** Null when nobody has said how much a unit holds. */
  litres: number | null;
  products: number;
}

/** What moved in the period, by what kind of movement it was. */
interface PeriodFlow {
  purchasedOre: number;
  /**
   * What left the cellar and did not come back, at what it cost.
   *
   * Checkouts *net of returns*, because a checkout is not a sale: it is a crate
   * carried to a bar, and half of it comes home unopened. Counting the crate on
   * the way out would say the section got through twice what it did. What the
   * money was afterwards, sold or drunk by the crew, is not something the shelf
   * can know, so the figure says what it can stand behind: this much stock is
   * gone.
   *
   * Spill is not in here. The four figures divide the period between them, and
   * a reader adding them up has to get what actually moved.
   */
  consumedOre: number;
  /**
   * Stock destroyed, at what it cost: dropped at a pub and dropped in the
   * cellar, added together.
   *
   * Only the second half carries a figure, and that is not a gap. A spill at a
   * pub is stock the checkout has already taken off the shelf and charged for,
   * so pricing it again here would charge the section twice for one bottle.
   * What it cost is in `consumedOre`, which is the honest place for it: the
   * shelf cannot tell a bottle that was drunk from one that hit the floor
   * after it left the building.
   */
  wastedOre: number;
  /**
   * What a stocktake or a correction moved the shelf by, netted over the
   * period.
   *
   * Two kinds, not one, which is why this is not called "inventering". A COUNT
   * is a physical finding: somebody counted the shelf and it did not hold what
   * the log predicted, so a negative figure here is stock gone that no
   * checkout, no spill and no sale accounts for. A CORRECTION is a fix to an
   * earlier entry, a delivery typed at the wrong quantity, which moves the
   * shelf by the same arithmetic and means something else entirely.
   *
   * Kept together because both are adjustments to what the log claimed, and the
   * four figures have to divide the period between them or the card does not
   * add up. Told apart is a job for the log, which names each entry's kind; the
   * label here says "justeringar" rather than promising an inventering it
   * cannot deliver on its own.
   */
  adjustmentOre: number;
}

interface ProductMover {
  id: string;
  name: string;
  category: DrinkCategory;
  /** Öre that left the shelf through this product in the period and did not come
   *  back, as a positive figure: what was got through, and what was spilled. */
  outOre: number;
  /** What it is worth on the shelf at the end of the period. */
  valueOre: number;
}

export interface StockStats {
  points: ValuePoint[];
  holdings: CategoryHolding[];
  flow: PeriodFlow;
  movers: ProductMover[];
  /** Every tag any product carries, for the filter. Not only the ones that
   *  survived it, or narrowing once would leave nothing to widen with. */
  tags: string[];
  /** The whole shelf, whatever the filter says: what the figures below are a
   *  part of. */
  wholeShelfOre: number;
}

const zero = (): Record<DrinkCategory, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<DrinkCategory, number>;

/**
 * The calendar day a movement belongs to, in Stockholm.
 *
 * Not UTC. An occurredAt is stored as the day somebody picked, at midnight, so
 * slicing the ISO string reads back the same day; but "now" in UTC is yesterday
 * for two hours of every Swedish evening, which is how the series came to stop
 * a day short of today. The section keeps a Swedish calendar. See
 * lib/domain/date.ts.
 */
const day = (d: Date): string => stockholmDay.format(d);

/**
 * Stock destroyed, wherever it was standing when it happened.
 *
 * Two kinds because the ledger has to keep them apart: a spill at a pub had
 * already left the cellar and moves nothing, a bottle broken in the cellar
 * comes off the shelf. Nobody reading a term's figures cares which, so the
 * screen adds them, and this is the one place that says so.
 *
 * Only SPOILAGE brings a value with it, for the same reason. A WASTE's cost
 * left at the checkout that carried it out of the door, and counting it here
 * as well would charge the section twice for one bottle.
 */
const destroyed = (kind: StockEntryKind): boolean =>
  kind === "WASTE" || kind === "SPOILAGE";

/**
 * What a movement takes off the shelf for good, as a positive figure.
 *
 * A return is part of it and adds back: out and home again is a net nothing,
 * and counting the crate on the way out would say the section got through twice
 * what it did.
 *
 * `withSpill` is what tells the two readers apart. The four figures on the
 * screen are a division of the period and must not overlap, so what was drunk
 * and what was dropped are separate there; a product's own line is asking a
 * different question, "how much of this left the shelf", and a bottle on the
 * floor left it.
 */
const gone = (
  kind: StockEntryKind,
  valueDeltaOre: number,
  withSpill: boolean,
): number =>
  kind === "CHECKOUT" || kind === "RETURN" || (withSpill && destroyed(kind))
    ? -valueDeltaOre
    : 0;

/**
 * Everything the statistics page shows, in two queries.
 *
 * The series walks the log forward and emits a point on each day something
 * happened, which is what a value over time *is*: between two movements the
 * shelf is worth what it was worth, and a point per calendar day would be
 * hundreds of copies of the same figure.
 */
export async function getStockStats(q: StockStatsQuery = {}): Promise<StockStats> {
  const to = q.to || today();
  const levels = await getStockLevels(to);

  const chosen = (p: StockLevelDto): boolean =>
    (!q.categories?.length || q.categories.includes(p.category)) &&
    (!q.tags?.length || q.tags.some((tag) => hasTag(p.tags, tag)));

  const kept = levels.filter(chosen);
  const keptIds = new Set(kept.map((p) => p.id));
  const categoryOf = new Map(kept.map((p) => [p.id, p.category]));

  // Every movement up to the end of the period, for the products that survived
  // the filter. Before `from` as well as after it: the value on the first day
  // shown is everything that ever happened before it, and a series that starts
  // at zero would say the cellar was empty in January because nobody looked
  // earlier than February.
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

  /**
   * What the shelf was worth at the end of each day something happened, and
   * what it was worth going into the window.
   *
   * The opening figure is everything that ever happened before `from`, which is
   * why the query above does not start there: a series that began at zero would
   * say the cellar was empty in January because nobody looked earlier than
   * February.
   */
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
   * A point per calendar day, not per day something happened.
   *
   * A shelf has a value on a Tuesday nobody touched it, and a series that skips
   * those days draws the week between two deliveries as a straight climb and
   * puts its dates at even spacing they never had. So the days are walked and
   * the last close is carried forward across them.
   *
   * Long periods are sampled rather than drawn to the day: a year is 365 points
   * and fine, but "allt" over a decade is a payload nobody reads at 960 pixels
   * wide. Every nth day, and always the last one, so the period still ends
   * where it says it does.
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
    // A product that came home with more than went out is a mistake somewhere
    // else, not a product that produced stock; it simply does not rank.
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
