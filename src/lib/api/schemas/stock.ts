// Request bodies for everything under /api/stock.
//
// Shared with the screens, so the shape a form sends and the shape a route
// accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";
import { MAX_TAG, MAX_TAGS, cleanTags } from "@/lib/stock/tags";

export const StockKind = z.enum(["UNIT", "VOLUME"]);

/** The five the bar keeps its stock in. See lib/domain/types.ts. */
export const DrinkCategory = z.enum([
  "SPRITDRYCK",
  "VIN",
  "OVRIG_JASTDRYCK",
  "OL",
  "ALKOHOLDRYCKSLIKNANDE",
]);

export const StockEntryKind = z.enum([
  "PURCHASE",
  "CHECKOUT",
  "RETURN",
  "WASTE",
  "SPOILAGE",
  "COUNT",
  "CORRECTION",
]);

/**
 * Alcohol by volume, per cent. Sent as a number so the form and the column
 * agree; two decimals because that is what the column holds and what a label
 * ever states.
 */
const Abv = z.number().min(0).max(100);

/** POST /api/stock/products, and PATCH with everything optional. */
/** A barcode as it is scanned or typed: digits only, EAN-8 through GTIN-14. */
const Ean = Trimmed.regex(/^\d{8,14}$/, { error: "a barcode is 8 to 14 digits" });

/**
 * Systembolaget's article number, digits only.
 *
 * The form takes a pasted product URL as well and reduces it to this before
 * sending (lib/stock/systembolaget.ts). The route accepts only the number, so
 * what is stored is one thing and not sometimes a link.
 *
 * Nullable rather than optional-only: clearing the field has to be expressible,
 * and `undefined` in a PATCH means "leave it alone".
 */
const SystembolagetId = Trimmed.regex(/^\d{3,10}$/, {
  error: "a Systembolaget article number is 3 to 10 digits",
});

/**
 * The free labels a product carries: "whisky", "cognac", "vodka".
 *
 * Optional, unlike everything else on a product, because a tag is a convenience
 * for finding things and not a fact the report or the shelf depends on.
 *
 * Cleaned rather than merely checked: the same list arrives from a form where a
 * tag can be typed, so trimming, dropping the blanks and keeping one of a tag
 * spelled two ways happens once, here, and the route stores what comes out. The
 * two caps are on the shape of the thing, not on the language: see
 * lib/stock/tags.ts.
 */
const Tags = z
  .array(Trimmed.min(1).max(MAX_TAG, { error: `a tag is at most ${MAX_TAG} characters` }))
  .max(MAX_TAGS, { error: `a product carries at most ${MAX_TAGS} tags` })
  .transform(cleanTags);

/**
 * A product, and everything it needs before it can be one.
 *
 * Nothing here is optional but the tags, and each part earns it. The tags are
 * the exception because they are a way of finding a product rather than part of
 * what it is. The barcode is how stock
 * gets registered at all. The strength and the size are what the
 * restaurangrapport is made of (litres and pure alcohol) so a product missing
 * either quietly leaves itself out of the return. The cost is what the shelf's
 * value is a sum of, and one unpriced product makes the total a guess.
 *
 * Which of the two sizes applies follows from the kind, so that pair stays
 * nullable here and the route decides. A `.refine` would have said it better
 * and cannot: `PatchStockProduct` below is this schema made partial, and a
 * refined schema has no `.partial()`.
 */
export const CreateStockProduct = z.object({
  name: NonEmpty,
  ean: Ean,
  kind: StockKind,
  category: DrinkCategory,
  abv: Abv,
  unitMl: z.int().positive().nullish(),
  nominalMl: z.int().positive().nullish(),
  costPriceOre: Ore.min(0),
  /**
   * How long the product keeps from delivery, in whole months.
   *
   * Nullable rather than optional-only, so clearing it is expressible: a
   * product that turns out not to go off has to be able to stop raising
   * checks. Capped at twenty years, which is not a shelf life anybody means but
   * is the point past which a typo is more likely than a claim.
   */
  shelfLifeMonths: z.int().positive().max(240).nullish(),
  systembolagetId: SystembolagetId.nullish(),
  // No default: absent has to keep meaning "not touching these" once this
  // schema is made partial for the PATCH below, and a default would make an
  // untouched field arrive as an empty list, i.e. as an instruction to clear
  // them. The POST fills the gap in with an empty list itself.
  tags: Tags.optional(),
});
export type CreateStockProduct = z.infer<typeof CreateStockProduct>;

export const PatchStockProduct = CreateStockProduct.partial();
export type PatchStockProduct = z.infer<typeof PatchStockProduct>;

/**
 * POST /api/stock/entries: one movement of the log.
 *
 * Quantities are signed deltas, and the sign is the caller's to get right: the
 * route refuses a purchase that takes stock away and a serving that adds it,
 * because a kind and a sign that disagree is a row nobody can read later. See
 * `entryFault` in lib/stock/entry.ts, which is the same rule the form applies
 * before offering the button.
 *
 * `readings` are the grams behind a volume figure. They are not an alternative
 * to `volumeMl`. The route derives the millilitres from them and refuses a
 * body that states both, so there is never a stored volume that its own
 * readings disagree with.
 */
export const CreateStockEntry = z.object({
  productId: Id,
  kind: StockEntryKind,
  occurredAt: IsoDate,
  units: z.int().optional(),
  /**
   * What this does to the open bottles at each rung. Negative takes them off
   * the shelf, positive puts them on.
   *
   * Keyed by the rung as a string, because that is what JSON gives back. Only
   * the four the bar judges bottles at. Anything else is a client inventing a
   * precision nobody has.
   */
  open: z
    .object({
      "80": z.int().optional(),
      "60": z.int().optional(),
      "40": z.int().optional(),
      "20": z.int().optional(),
    })
    .optional(),
  /**
   * On a COUNT: what is actually on the shelf, counted.
   *
   * Absolute, not a delta. A stocktake is somebody saying what is there, and
   * working out how far that is from the log is arithmetic nobody should do
   * standing in a cellar. The route subtracts what it expected and writes the
   * difference, which is the only number worth keeping.
   */
  counted: z
    .object({
      sealed: z.int().min(0).max(100_000),
      open: z
        .object({
          "80": z.int().min(0).optional(),
          "60": z.int().min(0).optional(),
          "40": z.int().min(0).optional(),
          "20": z.int().min(0).optional(),
        })
        .optional(),
    })
    .optional(),
  /**
   * The event this belongs to. Required for the three kinds that make up a
   * night. A movement of stock to or from a bar that belongs to no night is a
   * row nothing can ever reconcile.
   */
  eventId: Id.nullish(),
  /**
   * On a WASTE: how many things were destroyed, cans or bottles.
   *
   * Its own figure because a spill on an event moves no stock: the goods left the
   * cellar when they were checked out, and taking them off the shelf again
   * would remove them twice.
   *
   * Never on a SPOILAGE, which is the same loss suffered in the cellar. That
   * stock never left, so it comes off the shelf through `units` and `open` like
   * any other removal, and the route refuses this field on it.
   */
  spilledQty: z.int().min(0).optional(),
  /**
   * Which rung the row is about: 0 for a whole thing, or one of the four. On a
   * spill it says which bottles were dropped. A dropped bottle loses
   * everything left in it, so the rung is the whole of what it cost.
   */
  level: z.union([z.literal(0), z.literal(80), z.literal(60), z.literal(40), z.literal(20)]).optional(),
  lotId: Id.nullish(),
  expenseId: Id.nullish(),
  correctsId: Id.nullish(),
  note: NonEmpty.max(500).nullish(),
})
;
export type CreateStockEntry = z.infer<typeof CreateStockEntry>;

/** POST /api/stock/events: an event to book a night's movements against. */
export const CreateStockEvent = z.object({
  name: NonEmpty.max(120),
  date: IsoDate,
});
export type CreateStockEvent = z.infer<typeof CreateStockEvent>;

/**
 * POST /api/stock/events/[id]/cells: cells of an event sheet, as they should read.
 *
 * Absolute, not a difference. A cell *is* a row now, one per event,
 * product, direction and rung, so what arrives here is what the row should
 * say, and zero means there should be no row at all. Sending differences would
 * mean the browser computing them against a screen that may be minutes old.
 *
 * `expected` is what the cell showed when somebody decided on `qty`. If the row
 * has moved since (the other phone in the cellar) the cell is refused with
 * the figure it should have read, rather than one person's work quietly
 * replacing the other's.
 */
export const CellLevel = z.union([
  z.literal(0),
  z.literal(80),
  z.literal(60),
  z.literal(40),
  z.literal(20),
]);

export const WriteStockCells = z.object({
  occurredAt: IsoDate,
  cells: z
    .array(
      z.object({
        productId: Id,
        /** The three columns of a night. Nothing else is registered here. */
        kind: z.enum(["CHECKOUT", "RETURN", "WASTE"]),
        /** 0 for a whole thing, a sealed bottle or any can, or a rung. */
        level: CellLevel,
        /** What the cell should say. Zero removes the row. */
        qty: z.int().min(0).max(1_000_000),
        /** What it said when somebody decided that. */
        expected: z.int().min(0),
      }),
    )
    .min(1)
    .max(500),
  note: NonEmpty.max(500).nullish(),
});
export type WriteStockCells = z.infer<typeof WriteStockCells>;

/**
 * PATCH /api/stock/entries/[id]: a delivery or a spill, corrected.
 *
 * Only the size. Which product, which direction and which rung a row is about
 * are what it *is*; a row that changed those would be a different movement
 * wearing an old one's history, and the honest way to do that is to remove this
 * one and enter the other.
 */
export const PatchStockEntry = z.object({
  qty: z.int().min(0).max(1_000_000),
  occurredAt: IsoDate.optional(),
  note: NonEmpty.max(500).nullish(),
});
export type PatchStockEntry = z.infer<typeof PatchStockEntry>;

/**
 * PATCH /api/stock/settings.
 *
 * How many days before a delivery's estimated best-before to start asking about
 * it. Section-wide, because the notice period is about how long it takes to
 * drink a crate once somebody knows it needs drinking, which is the same
 * however long the product itself keeps.
 *
 * Bounded at a year. Beyond that every delivery is permanently due and the
 * warning has stopped saying anything.
 */
export const UpdateStockSettings = z.object({
  expiryLeadDays: z.int().min(0).max(365),
});
export type UpdateStockSettings = z.infer<typeof UpdateStockSettings>;
