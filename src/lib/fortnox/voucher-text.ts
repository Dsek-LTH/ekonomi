// The text a voucher carries in Fortnox: what the bookkeeper wrote when the
// utlägg was booked ("PU <namn> …" for a reimbursement, the cardholder's name
// for a card purchase), with the utlägg's own reference in parentheses at the
// end: "PU Anna Andersson lunch (DEK26-0043)".
//
// The reference is what ties a line in the Fortnox ledger back to an utlägg in
// this app for anyone reading the books, so it is the part that must survive:
// Fortnox truncates Description at 200 characters, and a reference that fell off
// the end would leave a voucher no one can trace, silently. Hence the text,
// which someone can always read more of here, is what gives way instead.

/** Fortnox's own limit on Voucher.Description. */
export const VOUCHER_DESCRIPTION_MAX = 200;

/**
 * `description` with `reference` appended in parentheses, trimmed to fit
 * Fortnox's limit. An utlägg with no reference yet (nothing exportable is in
 * that state, but the field is nullable) just gets its text.
 */
export function voucherText(description: string, reference: string | null): string {
  const text = description.trim();
  if (!reference) return text.slice(0, VOUCHER_DESCRIPTION_MAX);

  const suffix = `(${reference})`;
  // The space between the two is part of what has to fit.
  const room = VOUCHER_DESCRIPTION_MAX - suffix.length - 1;
  const head = room > 0 ? text.slice(0, room).trimEnd() : "";
  return head ? `${head} ${suffix}` : suffix;
}
