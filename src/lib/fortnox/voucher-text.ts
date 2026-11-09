// Voucher text in Fortnox: the bookkeeper's text plus the utlägg reference in parentheses,
// e.g. "PU Anna Andersson lunch (DEK26-0043)". Fortnox truncates Description at 200
// characters and the reference must survive, so the text gives way.

export const VOUCHER_DESCRIPTION_MAX = 200;

/** `description` with `reference` appended in parentheses, trimmed to fit. A missing reference yields just the text. */
export function voucherText(description: string, reference: string | null): string {
  const text = description.trim();
  if (!reference) return text.slice(0, VOUCHER_DESCRIPTION_MAX);

  const suffix = `(${reference})`;
  const room = VOUCHER_DESCRIPTION_MAX - suffix.length - 1;
  const head = room > 0 ? text.slice(0, room).trimEnd() : "";
  return head ? `${head} ${suffix}` : suffix;
}
