// Whether a movement may be written to the log, and why not.
//
// The same shape as `voucherBlocker` in lib/domain/voucher.ts, and for the same
// reason: the form has to know whether to offer the button and the route has to
// refuse a row that should not exist, and those two are one rule. Two would be
// a button that is live for a movement the server then rejects.
//
// Pure over plain data. Nothing here reads the database — whether the product
// exists is the route's question, whether the *movement* makes sense is this
// one's.

import type { StockEntryKind, StockKind } from "@/lib/domain/types";

/**
 * Why this movement cannot be written. Each value is a message key under
 * `errors.stock`, so the route returns it as a code and the screen shows the
 * same sentence.
 */
export type EntryFault =
  | "nothingMoved"
  | "purchaseNotPositive"
  | "removalNotNegative"
  | "unitsOnVolumeOnly"
  | "volumeOnUnitProduct"
  | "readingsOnUnitProduct"
  | "readingsAndVolume"
  | "correctionNeedsTarget";

/** A movement, as the rule needs it. */
export interface ProposedEntry {
  kind: StockEntryKind;
  units: number;
  volumeMl: number;
  openBottles: number;
  readings?: readonly number[];
  correctsId?: string | null;
}

/**
 * The kinds whose sign is fixed by what they mean.
 *
 * A purchase adds and a serving or a spill removes; nothing else about the row
 * says so, and a serving entered as +83 would read as a delivery to everyone
 * who came after. COUNT and CORRECTION are deliberately absent: a count can go
 * either way — that is the whole point of counting — and so can a correction.
 */
const ADDS: readonly StockEntryKind[] = ["PURCHASE"];
const REMOVES: readonly StockEntryKind[] = ["SERVING", "WASTE"];

export function entryFault(
  entry: ProposedEntry,
  product: { kind: StockKind },
): EntryFault | null {
  const { kind, units, volumeMl, openBottles, readings } = entry;

  // A row that moves nothing is not a record of anything. It would sit in the
  // log forever, saying that on some date somebody moved no vodka.
  if (units === 0 && volumeMl === 0 && openBottles === 0) return "nothingMoved";

  if (product.kind === "UNIT") {
    // A can has no liquid of its own to account for — its volume is its count
    // times what one holds. A millilitre figure here is a form filled in
    // against the wrong product.
    if (volumeMl !== 0 || openBottles !== 0) return "volumeOnUnitProduct";
    if (readings && readings.length > 0) return "readingsOnUnitProduct";
  }

  // Both a weighing and a volume is two answers to one question, and nothing
  // downstream could tell which was meant. The route derives the volume from
  // the readings; a caller that has already done the arithmetic should send the
  // readings and let it be redone.
  if (readings && readings.length > 0 && volumeMl !== 0) return "readingsAndVolume";

  if (ADDS.includes(kind) && (units < 0 || volumeMl < 0)) return "purchaseNotPositive";
  if (REMOVES.includes(kind) && (units > 0 || volumeMl > 0)) return "removalNotNegative";

  // "unitsOnVolumeOnly" is not a fault a UNIT product can have — units are all
  // it has — and on a VOLUME product units are the sealed bottles, which are
  // just as real. Kept in the type because the screens name the fault and the
  // set is the contract; see the note on `openBottles` below.
  if (product.kind === "VOLUME" && openBottles !== 0 && volumeMl === 0 && units === 0) {
    // Opening a bottle moves a sealed one into the open count and its whole
    // contents with it. An open-bottle count moving on its own leaves liquid
    // unaccounted for in both directions.
    return "unitsOnVolumeOnly";
  }

  // A correction that names nothing is just another movement, and the log loses
  // the one thing that made it a correction.
  if (kind === "CORRECTION" && !entry.correctsId) return "correctionNeedsTarget";

  return null;
}
