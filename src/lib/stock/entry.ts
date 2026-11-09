// Whether a movement may be written to the log. Shared by the form and the route, like
// `voucherBlocker` in lib/domain/voucher.ts. Pure over plain data.

import { LEVELS, openCount, type OpenBottles } from "./levels";
import type { StockEntryKind, StockKind } from "@/lib/domain/types";

/** Each value is a message key under `errors.stock`. */
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
  /** On a spill: how many things it destroyed. */
  spilledQty?: number;
  correctsId?: string | null;
}

// Kinds whose sign is fixed. COUNT and CORRECTION can go either way, and WASTE moves no stock.
// SPOILAGE is a removal because a bottle broken in the cellar never left the shelf.
const ADDS: readonly StockEntryKind[] = ["PURCHASE", "RETURN"];
const REMOVES: readonly StockEntryKind[] = ["CHECKOUT", "SPOILAGE"];

export function entryFault(entry: ProposedEntry, product: { kind: StockKind }): EntryFault | null {
  const { kind, units, open } = entry;
  const movedLevels = LEVELS.some((level) => (open?.[level] ?? 0) !== 0);

  // A spill (WASTE) moves no stock: what was dropped already left at checkout, so removing it
  // again would count it twice. Its quantity is in its own column. SPOILAGE is an ordinary removal.
  if (kind === "WASTE") {
    if ((entry.spilledQty ?? 0) === 0) return "nothingSpilled";
    if (units !== 0 || movedLevels) return "spillMovesNoStock";
    return null;
  }

  if (units === 0 && !movedLevels) return "nothingMoved";

  if (product.kind === "UNIT" && movedLevels) return "volumeOnUnitProduct";

  // Open levels may only be raised by a return (where the bottle is judged), a count or a correction.
  const raises = LEVELS.some((level) => (open?.[level] ?? 0) > 0);
  if (raises && !["RETURN", "COUNT", "CORRECTION"].includes(kind)) {
    return "levelsOnReturnOnly";
  }

  if (ADDS.includes(kind) && units < 0) return "purchaseNotPositive";
  if (REMOVES.includes(kind) && (units > 0 || openCount(open ?? {}) > 0)) {
    return "removalNotNegative";
  }

  // Everything bought arrives sealed.
  if (kind === "PURCHASE" && movedLevels) return "purchaseArrivesSealed";

  if (kind === "CORRECTION" && !entry.correctsId) return "correctionNeedsTarget";

  return null;
}
