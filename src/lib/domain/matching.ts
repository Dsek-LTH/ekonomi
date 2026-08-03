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

// The hint shown under both transaction pickers is `expenses.noMatchHint` in
// messages: a missing purchase is nearly always a bank file that hasn't been
// imported yet rather than anything the submitter can fix, so the text points
// at that before it points at them.
