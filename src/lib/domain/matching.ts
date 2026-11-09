// When a bank transaction settles an expense: the two must cancel out exactly (+250 on the utlägg,
// -250 in the bank), so a refund can only settle a return. The tolerance is for the client's SEK
// floats; the server compares öre integers.
export function cancelsOut(bankAmount: number, grossAmount: number): boolean {
  if (!grossAmount) return false;
  return Math.abs(bankAmount + grossAmount) < 0.005;
}

/** Whether an utlägg paid this way may be matched to a bank transaction at all. A match says the card paid; an eget utlägg says the member did. Both would pay twice, so only card purchases match (changing payment type away from the card withdraws the match, see the PATCH route). */
export function isMatchable(paymentType: string): boolean {
  return paymentType === "CARD";
}

interface MatchableTransaction {
  id: string;
  amount: number;
  /** YYYY-MM-DD. Optional, so a list without dates still ranks by amount. */
  transactionDate?: string;
  matchedExpenseId?: string;
  matchedExpenseRef?: string;
}

/** How many days apart a row may be from the purchase and still be taken for it when only the amount differs. */
const NEAR_DAYS = 3;

/** Why a row cannot settle this claim. A row already claimed by another utlägg says only that, whatever its amount. For a free row, the direction is asked before the size. */
type MatchBlock =
  /** Money out where money in is needed, or the reverse. */
  | "direction"
  /** Points the right way, wrong size. */
  | "amount"
  /** Would settle it, but another utlägg already claims it. */
  | "taken";

export interface MatchCandidate<T> {
  txn: T;
  selectable: boolean;
  blocked: MatchBlock | null;
  /** How much bigger the row is than the claim, signed, same unit as both. Meaningless where the direction is wrong. */
  offBy: number;
  /** Days between the row and the purchase, either way. Null where either date is unknown. */
  daysOff: number | null;
  /** Very likely this purchase with the amount typed wrong: right direction, free, within NEAR_DAYS, only the amount differs. The screen offers to take the row's amount. */
  fixable: boolean;
}

/** Every bank row, ranked for this claim, each saying whether it settles it and why not. Nothing is filtered out: a row that cannot be picked carries its reason.
 * @param grossAmount The claim as a *signed* amount: positive for money spent, negative for money coming back (the wizard's form holds a magnitude and a separate sign toggle).
 * @param keepTransactionId The transaction id the claim already holds; counts as free so it shows as picked while editing. */
export function matchCandidates<T extends MatchableTransaction>(
  transactions: readonly T[],
  grossAmount: number,
  keepTransactionId?: string | null,
  /** The utlägg's purchase date, YYYY-MM-DD. Ranks the rows nearest it first. */
  purchaseDate?: string | null,
): MatchCandidate<T>[] {
  const day = (iso?: string | null) => (iso ? Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) : NaN);
  const bought = day(purchaseDate);
  // Money coming back is settled by an incoming row; money spent, by an outgoing one.
  const incoming = grossAmount < 0;
  const magnitude = Math.abs(grossAmount);

  return transactions
    .map((txn) => {
      const wrongWay = incoming ? txn.amount <= 0 : txn.amount >= 0;
      const taken = Boolean(txn.matchedExpenseId) && txn.id !== keepTransactionId;
      const fits = cancelsOut(txn.amount, grossAmount);
      const blocked: MatchBlock | null = taken
        ? "taken"
        : wrongWay
          ? "direction"
          : !fits
            ? "amount"
            : null;
      const on = day(txn.transactionDate);
      const daysOff =
        Number.isNaN(bought) || Number.isNaN(on)
          ? null
          : Math.round(Math.abs(on - bought) / 86_400_000);
      return {
        txn,
        selectable: blocked === null,
        blocked,
        // Magnitudes, so a purchase and a return read the same: how far off is this row.
        offBy: Math.round((Math.abs(txn.amount) - magnitude) * 100) / 100,
        daysOff,
        fixable:
          blocked === "amount" &&
          !taken &&
          magnitude > 0 &&
          daysOff !== null &&
          daysOff <= NEAR_DAYS,
      };
    })
    .sort(
      (a, b) =>
        // Selectable first, then closest by size, so a row someone else claimed for exactly this amount
        // sits under the ones that work. Then by day: same-day with a 3 kr difference is a mistyped purchase.
        Number(b.selectable) - Number(a.selectable) ||
        (a.daysOff ?? Infinity) - (b.daysOff ?? Infinity) ||
        Math.abs(a.offBy) - Math.abs(b.offBy) ||
        // A stable last resort so equal rows do not swap places between renders.
        a.txn.id.localeCompare(b.txn.id),
    );
}
