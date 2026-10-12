// What a rental calls itself in the archive.
//
// Not a field on the form. A rental's title is the renter and the fact that it
// is a rental, which is exactly what the form's other answers already say.
//
// Swedish, fixed, and not a translation lookup. It ends up on a document two
// parties are bound by, and a contract that renamed itself because a reader
// had switched the interface to English would be two agreements. Same reason
// lib/expense/document.ts spells its payment types out.

/**
 * What a rental is called in the archive.
 *
 * Derived rather than typed. The list needs a title and the person drawing the
 * contract has already said the only two things one would contain, so asking
 * for it was asking them to write out their own answers. Still stored on the
 * row rather than computed on read, because it is editable afterwards: somebody
 * who wants "Ljud till nollningen" should be able to say so.
 */
export function rentalTitle(counterparty: string): string {
  const who = counterparty.trim();
  return who ? `Uthyrning till ${who}` : "Uthyrning";
}
