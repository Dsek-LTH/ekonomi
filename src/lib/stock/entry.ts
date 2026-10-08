// Whether a movement may be written to the log, and why not.
//
// The same shape as `voucherBlocker` in lib/domain/voucher.ts, and for the same
// reason: the form has to know whether to offer the button and the route has to
// refuse a row that should not exist, and those two are one rule. Two would be
// a button that is live for a movement the server then rejects.
//
// Pure over plain data. Nothing here reads the database: whether the product
// exists is the route's question, whether the *movement* makes sense is this
// one's.

import { LEVELS, openCount, type OpenBottles } from "./levels";
import type { StockEntryKind, StockKind } from "@/lib/domain/types";

/**
 * Why this movement cannot be written. Each value is a message key under
 * `errors.stock`, so the route returns it as a code and the screen shows the
 * same sentence.
 */
type EntryFault =
  | "nothingMoved"
  | "purchaseNotPositive"
  | "removalNotNegative"
  | "purchaseArrivesSealed"
  | "nothingSpilled"
  | "spillMovesNoStock"
  | "volumeOnUnitProduct"
  | "levelsOnReturnOnly"
  | "correctionNeedsTarget";

/** A movement, as the rule needs it. */
export interface ProposedEntry {
  kind: StockEntryKind;
  /** Cans, or sealed bottles. */
  units: number;
  /** What it does to the open bottles at each level. */
  open?: OpenBottles;
  /** On a spill: how many things it destroyed. Its own figure, see below. */
  spilledQty?: number;
  correctsId?: string | null;
}

/**
 * The kinds whose sign is fixed by what they mean.
 *
 * A delivery and a homecoming add; a checkout and a cellar write-off take away.
 * Nothing else about the row says which, and a checkout entered as +3 would
 * read as stock appearing to everyone who came after.
 *
 * COUNT and CORRECTION are deliberately absent: a count can go either way,
 * that is the whole point of counting, and so can a correction. WASTE is
 * absent because it moves no stock at all, so it has no sign to get right.
 * SPOILAGE is here rather than beside it precisely because it does move stock:
 * a bottle broken in the cellar never left the shelf, so it leaves now.
 */
const ADDS: readonly StockEntryKind[] = ["PURCHASE", "RETURN"];
const REMOVES: readonly StockEntryKind[] = ["CHECKOUT", "SPOILAGE"];

export function entryFault(
  entry: ProposedEntry,
  product: { kind: StockKind },
): EntryFault | null {
  const { kind, units, open } = entry;
  const movedLevels = LEVELS.some((level) => (open?.[level] ?? 0) !== 0);

  // ── A spill at a pub, which is the one kind that moves no stock ──
  //
  // What was dropped left the cellar when it was checked out; taking it off the
  // shelf again would remove it twice and the crate would come up short at the
  // next stocktake. So its quantity is in a column of its own, and every rule
  // below asks about the shelf columns, which is why a spill has to be answered
  // here rather than falling through them. It used to fall through, and every
  // spill came back as "nothing moved": the row was, correctly, moving no
  // stock at all.
  //
  // A bottle broken in the cellar is SPOILAGE and none of this applies to it.
  // That one never left, so it is an ordinary removal and falls through every
  // rule below exactly as a checkout does. Two kinds rather than one shape that
  // has to be read twice.
  if (kind === "WASTE") {
    if ((entry.spilledQty ?? 0) === 0) return "nothingSpilled";
    if (units !== 0 || movedLevels) return "spillMovesNoStock";
    return null;
  }

  // A row that moves nothing is not a record of anything. It would sit in the
  // log forever, saying that on some date somebody moved no vodka.
  if (units === 0 && !movedLevels) return "nothingMoved";

  // A can is never half a can. Levels against one are a form filled in on the
  // wrong product.
  if (product.kind === "UNIT" && movedLevels) return "volumeOnUnitProduct";

  // A bottle only climbs the ladder on the way back in, because coming back is
  // the one moment anybody looks at it and judges what is left. Anything else
  // may take bottles off a rung; only a return may put one on.
  //
  // COUNT and CORRECTION are exempt: a count is somebody standing at the shelf
  // looking at every bottle, which is the same act as judging a returning one,
  // and a correction exists to undo whatever the log got wrong.
  const raises = LEVELS.some((level) => (open?.[level] ?? 0) > 0);
  if (raises && !["RETURN", "COUNT", "CORRECTION"].includes(kind)) {
    return "levelsOnReturnOnly";
  }

  if (ADDS.includes(kind) && units < 0) return "purchaseNotPositive";
  if (REMOVES.includes(kind) && (units > 0 || openCount(open ?? {}) > 0)) {
    return "removalNotNegative";
  }

  // Everything bought arrives sealed. A delivery that moved a level is a
  // delivery of half-empty bottles, which is not a thing that happens and is
  // far more likely to be somebody in the wrong form.
  if (kind === "PURCHASE" && movedLevels) return "purchaseArrivesSealed";

  // A correction that names nothing is just another movement, and the log loses
  // the one thing that made it a correction.
  if (kind === "CORRECTION" && !entry.correctsId) return "correctionNeedsTarget";

  return null;
}
