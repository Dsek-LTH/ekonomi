// A rental's archive title, derived from the renter and the fact that it is a rental.
// Swedish and fixed, not a translation lookup: it ends up on a document two parties are
// bound by. Stored on the row rather than computed on read, since it is editable.
export function rentalTitle(counterparty: string): string {
  const who = counterparty.trim();
  return who ? `Uthyrning till ${who}` : "Uthyrning";
}
