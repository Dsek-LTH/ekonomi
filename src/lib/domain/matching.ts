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

// What both pickers say when nothing in the list can settle the claim is
// `NoMatchNote` in components/transaction-picker.tsx. It used to be one line of
// hint text guessing at an unimported bank file, which is one of the reasons and
// often the wrong one; the note names the case it is actually looking at and
// says that saving a draft is the way on, since a card purchase cannot be
// submitted unmatched at all (see `submitBlocker`).

/** As much of a bank row as choosing one needs. */
interface MatchableTransaction {
  id: string;
  amount: number;
  matchedExpenseId?: string;
  matchedExpenseRef?: string;
}

/**
 * Why a row cannot settle this claim.
 *
 * Each is a different sentence to a reader, which is the whole reason they are
 * told apart. A row of the right size pointing the wrong way is not "another
 * amount", it is the same amount going the other way, and saying the former
 * about it sends somebody off to check a figure that was never wrong.
 *
 * Ordered by what is asked first when the row is looked at: does it even point
 * the right way, is it the right size, and only then is it still free. A row
 * whose amount is wrong is reported as such whether or not somebody else has
 * claimed it, because saying "already claimed" of a row that would not have
 * fitted anyway is an answer that sends the reader after the wrong thing.
 */
export type MatchBlock =
  /** Money out where money in is needed, or the reverse. */
  | "direction"
  /** Points the right way, wrong size. */
  | "amount"
  /** Would settle it, but another utlägg already claims it. */
  | "taken";

/** A row, and whether picking it would actually settle the claim. */
export interface MatchCandidate<T> {
  txn: T;
  selectable: boolean;
  /** Null when it can be picked. See MatchBlock. */
  blocked: MatchBlock | null;
  /**
   * How much bigger the row is than the claim, signed, in the same unit as
   * both. Zero where they cancel out, and meaningless where the direction is
   * wrong, which is why the reader is told the direction instead.
   *
   * Carried rather than worked out again on screen: "6,50 kr mer än utlägget"
   * is what turns a greyed-out row into a mistyped amount, and the arithmetic
   * behind it belongs with the rule it comes from.
   */
  offBy: number;
}

/**
 * Every bank row, ranked for this claim, each saying whether it settles it and
 * why not.
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
 * Nothing is filtered out. It used to drop rows pointing the wrong way, rows
 * another utlägg had claimed, and everything past the five closest, which left
 * one question ("I know this purchase is on the card, why is it not listed?")
 * with four possible answers and the screen offering none of them. The worst of
 * them was silent: somebody else had already redovisat your purchase, and the
 * row simply was not there. Every row is returned now, carrying the reason it
 * cannot be picked, and the screen greys it and says so.
 *
 * @param grossAmount The claim as a *signed* amount: positive for money the
 *   section spent, negative for money coming back to it.
 * @param keepTransactionId The id of the row this claim already holds. It counts
 *   as free rather than taken, so it shows as picked while the claim is being
 *   edited rather than reading as somebody else's. A transaction id, not an
 *   expense id: it is what the screen has in hand.
 */
export function matchCandidates<T extends MatchableTransaction>(
  transactions: readonly T[],
  grossAmount: number,
  keepTransactionId?: string | null,
): MatchCandidate<T>[] {
  // Money coming back to the section is settled by an incoming row; money it
  // spent, by an outgoing one.
  const incoming = grossAmount < 0;
  const magnitude = Math.abs(grossAmount);

  return transactions
    .map((txn) => {
      const wrongWay = incoming ? txn.amount <= 0 : txn.amount >= 0;
      const taken = Boolean(txn.matchedExpenseId) && txn.id !== keepTransactionId;
      const fits = cancelsOut(txn.amount, grossAmount);
      const blocked: MatchBlock | null = wrongWay
        ? "direction"
        : !fits
          ? "amount"
          : taken
            ? "taken"
            : null;
      return {
        txn,
        selectable: blocked === null,
        blocked,
        // Magnitudes, so the figure reads the same for a purchase and for a
        // return: what is asked is "how far off is this row", not which way
        // round the two happen to be signed.
        offBy: Math.round((Math.abs(txn.amount) - magnitude) * 100) / 100,
      };
    })
    .sort(
      (a, b) =>
        // Selectable first, then closest by size. That puts a row somebody else
        // has claimed for exactly this amount directly under the ones that
        // work, which is where it does the most good: it is the answer to why
        // the purchase you are looking at cannot be picked.
        Number(b.selectable) - Number(a.selectable) ||
        Math.abs(a.offBy) - Math.abs(b.offBy) ||
        // A stable last resort, so two rows of the same size do not swap places
        // between renders.
        a.txn.id.localeCompare(b.txn.id),
    );
}
