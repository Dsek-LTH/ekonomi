// Request bodies for everything under /api/stock.
//
// Shared with the screens, so the shape a form sends and the shape a route
// accepts are one definition. See lib/api/parse.ts.
import { z } from "zod";
import { Id, IsoDate, NonEmpty, Ore } from "./common";

export const StockKind = z.enum(["UNIT", "VOLUME"]);

/** As Folkhälsomyndigheten names them. See lib/domain/types.ts. */
export const DrinkCategory = z.enum([
  "SPRITDRYCK",
  "VIN",
  "ANDRA_JASTA",
  "STARKOL",
  "ALKOHOLDRYCKSLIKNANDE",
  "FOLKOL",
  "LATTDRYCK",
  "OVRIGT",
]);

export const StockEntryKind = z.enum(["PURCHASE", "SERVING", "WASTE", "COUNT", "CORRECTION"]);

/** A weight on the scale. Whole grams — finer resolution than the glass varies
 *  by, so a fraction would be false precision. */
const Grams = z.int().min(0).max(100_000);

/** A volume in millilitres. Signed: a movement out is negative. */
const Ml = z.int();

/**
 * Alcohol by volume, per cent. Sent as a number so the form and the column
 * agree; two decimals because that is what the column holds and what a label
 * ever states.
 */
const Abv = z.number().min(0).max(100);

/** POST /api/stock/products, and PATCH with everything optional. */
export const CreateStockProduct = z.object({
  name: NonEmpty,
  kind: StockKind,
  category: DrinkCategory,
  abv: Abv.nullish(),
  unitMl: z.int().positive().nullish(),
  nominalMl: z.int().positive().nullish(),
  tareGrams: Grams.nullish(),
  fullGrams: Grams.nullish(),
  normalPriceOre: Ore.min(0).nullish(),
  minimumLevel: z.int().min(0).nullish(),
});
export type CreateStockProduct = z.infer<typeof CreateStockProduct>;

export const PatchStockProduct = CreateStockProduct.partial().extend({
  active: z.boolean().optional(),
});
export type PatchStockProduct = z.infer<typeof PatchStockProduct>;

/**
 * POST /api/stock/entries — one movement of the log.
 *
 * Quantities are signed deltas, and the sign is the caller's to get right: the
 * route refuses a purchase that takes stock away and a serving that adds it,
 * because a kind and a sign that disagree is a row nobody can read later. See
 * `entryFault` in lib/stock/entry.ts, which is the same rule the form applies
 * before offering the button.
 *
 * `readings` are the grams behind a volume figure. They are not an alternative
 * to `volumeMl` — the route derives the millilitres from them and refuses a
 * body that states both, so there is never a stored volume that its own
 * readings disagree with.
 */
export const CreateStockEntry = z.object({
  productId: Id,
  kind: StockEntryKind,
  occurredAt: IsoDate,
  units: z.int().optional(),
  volumeMl: Ml.optional(),
  openBottles: z.int().optional(),
  /** Whole bottles on the scale, and which weighing they belong to. */
  readings: z.array(Grams).max(200).optional(),
  /** Out of stock, so the derived volume is negative. */
  readingsAreRemoval: z.boolean().optional(),
  lotId: Id.nullish(),
  expenseId: Id.nullish(),
  correctsId: Id.nullish(),
  note: NonEmpty.max(500).nullish(),
});
export type CreateStockEntry = z.infer<typeof CreateStockEntry>;
