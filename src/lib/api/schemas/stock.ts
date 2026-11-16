// Request bodies for everything under /api/stock.
import { z } from "zod";
import { Id, IsoDate, NonEmpty, Ore, Trimmed } from "./common";
import { MAX_TAG, MAX_TAGS, cleanTags } from "@/lib/stock/tags";
import { validGtin } from "@/lib/stock/barcode";

const StockKind = z.enum(["UNIT", "VOLUME"]);

/** The five the bar keeps its stock in. See lib/domain/types.ts. */
const DrinkCategory = z.enum([
  "SPRITDRYCK",
  "VIN",
  "OVRIG_JASTDRYCK",
  "OL",
  "ALKOHOLDRYCKSLIKNANDE",
]);

const StockEntryKind = z.enum([
  "PURCHASE",
  "CHECKOUT",
  "RETURN",
  "WASTE",
  "SPOILAGE",
  "ISSUE",
  "COUNT",
  "CORRECTION",
]);

/** Which stock a request is about. Checked against the fixed set by the gate (lib/api/stock-gate.ts). */
const StockSlug = z.enum(["alcohol", "cafe"]);

/** Alcohol by volume, per cent, two decimals (the column's precision). */
const Abv = z.number().min(0).max(100);

/** POST /api/stock/products, and PATCH with everything optional. */
/** A barcode as scanned or typed: a valid GS1 code with check digit (lib/stock/barcode.ts); the section's own codes are valid too. */
const Ean = Trimmed.refine(validGtin, { error: "not a valid barcode" });

/**
 * Systembolaget's article number, digits only (the form reduces a pasted URL first, lib/stock/systembolaget.ts).
 * Nullable so clearing is expressible; `undefined` in a PATCH means leave it.
 */
const SystembolagetId = Trimmed.regex(/^\d{3,10}$/, {
  error: "a Systembolaget article number is 3 to 10 digits",
});

/**
 * The free labels a product carries ("whisky", "cognac"). Optional. Cleaned here once: trimmed, blanks dropped,
 * duplicates collapsed. The caps are on shape, not language: see lib/stock/tags.ts.
 */
const Tags = z
  .array(Trimmed.min(1).max(MAX_TAG, { error: `a tag is at most ${MAX_TAG} characters` }))
  .max(MAX_TAGS, { error: `a product carries at most ${MAX_TAGS} tags` })
  .transform(cleanTags);

/**
 * A product, and everything it needs before it can be one. Only the tags are optional. Barcode, strength and size feed
 * the restaurangrapport and the cost feeds the shelf value. Which of the two sizes applies follows from the kind, so
 * that pair stays nullable and the route decides (a `.refine` would break `.partial()` for PatchStockProduct).
 */
export const CreateStockProduct = z.object({
  /** The stock it is in. Set once: the PATCH route ignores it. */
  stock: StockSlug,
  /** Its type, which its accounts come from. Absent, the route takes the group its drink category names. */
  groupId: Id.optional(),
  /** Units in a pack (24 for a flak). Nullable so clearing is expressible. */
  packSize: z.int().min(2).max(1000).nullish(),
  name: NonEmpty,
  // Required unless `noBarcode`, which the route checks (a refine would break `.partial()`).
  ean: Ean.optional(),
  /** The product has no barcode at all (a keg), said on purpose: the route assigns one of the section's own codes. See lib/stock/barcode.ts. */
  noBarcode: z.boolean().optional(),
  kind: StockKind,
  // Required in a stock that files the restaurangrapport, which the route checks.
  category: DrinkCategory.optional(),
  abv: Abv.optional(),
  unitMl: z.int().positive().nullish(),
  nominalMl: z.int().positive().nullish(),
  costPriceOre: Ore.min(0),
  /** Months the product keeps from delivery. Nullable so clearing is expressible; capped at twenty years. */
  shelfLifeMonths: z.int().positive().max(240).nullish(),
  systembolagetId: SystembolagetId.nullish(),
  // No default: absent must mean "not touching these" under `.partial()`. The POST fills in an empty list itself.
  tags: Tags.optional(),
});
export type CreateStockProduct = z.infer<typeof CreateStockProduct>;

export const PatchStockProduct = CreateStockProduct.omit({ stock: true }).partial();
export type PatchStockProduct = z.infer<typeof PatchStockProduct>;

/**
 * POST /api/stock/entries: one movement of the log. Quantities are signed deltas; the route refuses a purchase that
 * takes stock away and a serving that adds it (`entryFault` in lib/stock/entry.ts, the same rule the form applies).
 */
export const CreateStockEntry = z.object({
  productId: Id,
  kind: StockEntryKind,
  occurredAt: IsoDate,
  units: z.int().optional(),
  /**
   * What this does to the open bottles at each rung (negative takes them off the shelf). Keyed by the rung as a string
   * (JSON); only the four rungs the bar judges bottles at.
   */
  open: z
    .object({
      "80": z.int().optional(),
      "60": z.int().optional(),
      "40": z.int().optional(),
      "20": z.int().optional(),
    })
    .optional(),
  /** On a COUNT: what is actually on the shelf, absolute not a delta. The route subtracts what it expected. */
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
  /** The event this belongs to. Required for the three kinds that make up a night. */
  eventId: Id.nullish(),
  /**
   * On a WASTE: how many things were destroyed, cans or bottles. Its own figure because a spill on an event moves no
   * stock (the goods left the cellar at check-out). Never on a SPOILAGE, which comes off the shelf through `units` and `open`.
   */
  spilledQty: z.int().min(0).optional(),
  /** Which rung the row is about: 0 for a whole thing, or one of the four. A dropped bottle loses everything left in it. */
  level: z
    .union([z.literal(0), z.literal(80), z.literal(60), z.literal(40), z.literal(20)])
    .optional(),
  expenseId: Id.nullish(),
  correctsId: Id.nullish(),
  note: NonEmpty.max(500).nullish(),
});
export type CreateStockEntry = z.infer<typeof CreateStockEntry>;

/** POST /api/stock/events: an event to book a night's movements against. */
const StockEventFields = z.object({
  name: NonEmpty.max(120),
  date: IsoDate,
  /** The cost centre the night's consumption is charged on. Null falls back to the stock's own. */
  costCenterId: Id.nullish(),
});

export const CreateStockEvent = StockEventFields.extend({ stock: StockSlug });
export type CreateStockEvent = z.infer<typeof CreateStockEvent>;

/** PATCH /api/stock/events/[id]: the same fields, as they should now read. */
export const PatchStockEvent = StockEventFields;
export type PatchStockEvent = z.infer<typeof PatchStockEvent>;

/**
 * POST /api/stock/events/[id]/cells: cells of an event sheet, as they should read. Absolute, not a difference: a cell is
 * a row (event, product, direction, rung) and zero means no row. `expected` is what the cell showed when `qty` was
 * decided; if the row has moved since, the cell is refused with the figure it should have read.
 */
const CellLevel = z.union([
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

/** PATCH /api/stock/entries/[id]: a delivery or a spill, corrected. Only the size: product, direction and rung are what a row is. */
export const PatchStockEntry = z.object({
  qty: z.int().min(0).max(1_000_000),
  occurredAt: IsoDate.optional(),
  note: NonEmpty.max(500).nullish(),
});
export type PatchStockEntry = z.infer<typeof PatchStockEntry>;

/**
 * POST /api/stock/moves: stock carried from one place to another, several products in one go. `from` and `to` are
 * StockPlace ids, or null for storage: a refill is storage to a fridge, a return is a place to storage. `batchId` is
 * made up by the client for this one submit, so sending it again (a phone with no signal retries) writes nothing twice.
 */
export const CreateStockMove = z.object({
  stock: StockSlug,
  from: Id.nullable(),
  to: Id.nullable(),
  batchId: z.uuid(),
  occurredAt: IsoDate,
  lines: z
    .array(z.object({ productId: Id, units: z.int().min(1).max(100_000) }))
    .min(1)
    .max(200),
  note: NonEmpty.max(500).nullish(),
});
export type CreateStockMove = z.infer<typeof CreateStockMove>;

/** An account as the chart writes it: four digits. Null clears it. */
const AccountNumber = Trimmed.regex(/^\d{4}$/, { error: "an account number is four digits" });

/**
 * PATCH /api/stock/stocks/[stock]: how a stock is booked, and its notice period for best-before checks.
 * Everything optional, and null means "not chosen": nothing is exported for a stock until its own are set.
 */
export const UpdateStock = z
  .object({
    /** Days before a delivery's estimated best-before to start asking about it. Bounded at a year. */
    expiryLeadDays: z.int().min(0).max(365).nullable(),
    consumptionCostCenterId: Id.nullable(),
    purchaseOffsetAccount: AccountNumber.nullable(),
    purchaseCostCenterId: Id.nullable(),
    lossCostCenterId: Id.nullable(),
    countDiffCostCenterId: Id.nullable(),
    boardCostAccount: AccountNumber.nullable(),
    boardCostCenterId: Id.nullable(),
    boardSalesAccount: AccountNumber.nullable(),
    boardSalesCostCenterId: Id.nullable(),
    voucherSeries: Trimmed.min(1).max(10).nullable(),
    postingStartsOn: IsoDate.nullable(),
  })
  .partial();
export type UpdateStock = z.infer<typeof UpdateStock>;

const StockGroupFields = z.object({
  name: NonEmpty.max(60),
  stockAccount: AccountNumber.nullable(),
  consumptionAccount: AccountNumber.nullable(),
  lossAccount: AccountNumber.nullable(),
  countDiffAccount: AccountNumber.nullable(),
});

/** POST /api/stock/groups: a new product type in a stock. Accounts can wait. */
export const CreateStockGroup = StockGroupFields.partial()
  .required({ name: true })
  .extend({ stock: StockSlug });
export type CreateStockGroup = z.infer<typeof CreateStockGroup>;

/** PATCH /api/stock/groups/[id]: its name and accounts. */
export const PatchStockGroup = StockGroupFields.partial();
export type PatchStockGroup = z.infer<typeof PatchStockGroup>;

/** POST /api/stock/places: a new place in a stock. Its cost centre and groups are chosen after. */
export const CreateStockPlace = z.object({ stock: StockSlug, name: NonEmpty.max(60) });
export type CreateStockPlace = z.infer<typeof CreateStockPlace>;

/**
 * PATCH /api/stock/places/[id]: its name, cost centre, the Authentik groups whose members may log moves to and from
 * it (the whole list, replacing what was there), and whether it is archived.
 */
export const PatchStockPlace = z.object({
  name: NonEmpty.max(60).optional(),
  costCenterId: Id.nullable().optional(),
  groups: z.array(Trimmed.min(1).max(200)).max(50).optional(),
  archived: z.boolean().optional(),
});
export type PatchStockPlace = z.infer<typeof PatchStockPlace>;
