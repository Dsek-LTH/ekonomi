// What the receipt panel does when the page's documents change (components/receipt/receipt-panel.tsx). Pure, so the
// sequences that once made the same tap open the panel one time and fold it the next can be tested as sequences.

export interface PanelState {
  /** The page has a source at all (documents, or a place to drop them). */
  source: boolean;
  /** It has at least one document. */
  receipt: boolean;
  /** It has none yet and takes uploads: the dropzone. */
  awaiting: boolean;
  /** Which documents, as one string, so a change to others is seen even when there were some before. */
  docs: string;
}

export const NO_PANEL: PanelState = { source: false, receipt: false, awaiting: false, docs: "" };

/**
 * `open`: slide it in (a page that picks its documents, see Source.onClose; on a phone the panel does not ask). `fold` and `unfold`: set it closed or open without
 * ceremony. `null`: leave it as it is. A phone folds a receipt that arrives, so the page is read first and the receipt
 * is a row under its title; a wide screen has room for both.
 */
export function arrivalAction(
  before: PanelState,
  now: PanelState,
  { phone, openOnChange }: { phone: boolean; openOnChange: boolean },
): "open" | "fold" | "unfold" | null {
  const appeared = now.source && !before.source;
  const receiptArrived = now.receipt && !before.receipt;
  const changed = now.receipt && now.docs !== before.docs;

  if (changed && openOnChange) return "open";
  if (phone) {
    if ((appeared && !now.awaiting) || receiptArrived) return "fold";
    if (now.awaiting && !before.awaiting) return "unfold";
    return null;
  }
  return receiptArrived && before.awaiting ? "unfold" : null;
}
