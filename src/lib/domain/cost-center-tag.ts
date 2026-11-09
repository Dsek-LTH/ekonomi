// A local cost centre (CostCenterSource in the schema) is never sent to Fortnox, which rejects the
// voucher if it is named. Its code goes into the row text instead: "Öl till pub (SEX-ALKO)". Written
// while booking and again at export (idempotent) for rows booked earlier or whose text lost it.

/** Fortnox's limit on a voucher row's text (TransactionInformation). */
const ROW_TEXT_MAX = 100;

const costCenterTag = (code: string): string => `(${code})`;

const hasTag = (text: string, code: string) => text.includes(costCenterTag(code));

/** `text` with the cost centre's tag at the end, unless already there. Shortens the text, not the tag, when they do not fit in `max`. */
export function withCostCenterTag(text: string, code: string, max = ROW_TEXT_MAX): string {
  if (!code || hasTag(text, code)) return text;
  const tag = costCenterTag(code);
  const room = max - tag.length - 1;
  const body = text.trim().slice(0, Math.max(0, room)).trim();
  return body ? `${body} ${tag}` : tag;
}

/** `text` with the cost centre's tag taken off, wherever it is. */
export function withoutCostCenterTag(text: string, code: string): string {
  if (!code || !hasTag(text, code)) return text;
  return text
    .replace(costCenterTag(code), "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The row text after its cost centre changed from `from` to `to`: a local code's tag comes off, a new local code's goes on. */
export function retagRowText(
  text: string,
  from: string,
  to: string,
  isLocal: (code: string) => boolean,
): string {
  let next = text;
  if (from && from !== to && isLocal(from)) next = withoutCostCenterTag(next, from);
  if (to && isLocal(to)) next = withCostCenterTag(next, to);
  return next;
}
