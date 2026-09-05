// When a bank transaction settles an expense.
//
// The two have to cancel out exactly: a 250 kr card purchase is +250 on the
// utlägg and −250 in the bank, so they sum to zero. That rules out a near miss
// (249,50) and a same-size row in the wrong direction (a refund can only settle
// a return, which is itself negative).
//
// Both sides must be in the same unit. The tolerance is there for the client,
// which works in SEK floats; the server compares öre integers, where anything
// that isn't equal differs by at least 1.
export function cancelsOut(bankAmount: number, grossAmount: number): boolean {
  if (!grossAmount) return false; // nothing to settle yet
  return Math.abs(bankAmount + grossAmount) < 0.005;
}

/**
 * Whether an utlägg paid this way may be matched to a bank transaction at all.
 *
 * A match is a statement: *this* row on the section's card is the money that
 * left for *this* purchase, so the purchase is accounted for and the row is
 * not outstanding. An eget utlägg says the opposite: the member's own money
 * left, and the section owes them it back.
 *
 * Both at once is the section paying for one purchase twice: once when the
 * card was swiped, and again into the member's account. So the match belongs
 * to the card purchase and to nothing else, and the two ways an utlägg can
 * acquire one, created with it (the "Redovisa" deep-link from a card
 * purchase) and given one afterwards (the match step), both ask this first.
 * Changing the payment type away from the card withdraws the claim and the
 * match with it; see the PATCH route.
 */
export function isMatchable(paymentType: string): boolean {
  return paymentType === "CARD";
}

// The hint shown under both transaction pickers is `expenses.noMatchHint` in
// messages: a missing purchase is nearly always a bank file that hasn't been
// imported yet rather than anything the submitter can fix, so the text points
// at that before it points at them.

/** As much of a bank row as choosing one needs. */
interface MatchableTransaction {
  id: string;
  amount: number;
  matchedExpenseId?: string;
}

/** A row, and whether picking it would actually settle the claim. */
export interface MatchCandidate<T> {
  txn: T;
  selectable: boolean;
}

/**
 * The bank rows worth offering for a claim, best first.
 *
 * Lives here rather than in the wizard because it is the matching rule and not
 * a piece of that screen, and because a rule inside an 800-line component is a
 * rule nothing can test. It was not tested, and it was wrong: it took the
 * amount from the form, where the figure is a *magnitude* and the sign lives on
 * a separate toggle, so `grossAmount < 0` was never true. Every return offered
 * the outgoing rows, never the refund that would settle it, and the continue
 * button stayed dead. A purchase's magnitude and its signed amount are the same
 * number, so nothing showed on the path everyone takes.
 *
 * @param grossAmount The claim as a *signed* amount: positive for money the
 *   section spent, negative for money coming back to it.
 * @param keepTransactionId The id of the row this claim already holds. It stays
 *   in the list even though it is spoken for, so it can show as picked while
 *   the claim is being edited rather than vanishing from under the selection.
 *   A transaction id, not an expense id: it is what the screen has in hand.
 *
 * Near misses are kept and marked unselectable rather than filtered out: seeing
 * a 249,50 purchase sitting there is what tells somebody the amount was
 * mistyped, which an empty list never would.
 */
export function matchCandidates<T extends MatchableTransaction>(
  transactions: readonly T[],
  grossAmount: number,
  keepTransactionId?: string | null,
  limit = 5,
): MatchCandidate<T>[] {
  // Money coming back to the section is settled by an incoming row; money it
  // spent, by an outgoing one.
  const incoming = grossAmount < 0;
  const magnitude = Math.abs(grossAmount);

  return transactions
    .filter(
      (txn) =>
        (!txn.matchedExpenseId || txn.id === keepTransactionId) &&
        (incoming ? txn.amount > 0 : txn.amount < 0),
    )
    .map((txn) => ({ txn, selectable: cancelsOut(txn.amount, grossAmount) }))
    .sort(
      (a, b) =>
        // Selectable first, then closest by size.
        Number(b.selectable) - Number(a.selectable) ||
        Math.abs(Math.abs(a.txn.amount) - magnitude) -
          Math.abs(Math.abs(b.txn.amount) - magnitude),
    )
    .slice(0, limit);
}
