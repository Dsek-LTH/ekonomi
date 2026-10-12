// A local cost centre, written into the row text.
//
// A local cost centre (see CostCenterSource in the schema) is never sent to
// Fortnox, which has never heard of it and rejects the whole voucher if it is
// named. The row then arrives in Fortnox with no cost centre at all, and the
// alko purchase on it reads like any other row on the same account. So the
// code goes into the row's text instead: "Öl till pub (SEX-ALKO)".
//
// It is written into the text while the voucher is being booked, not only on
// the way out, so the bookkeeper sees the row exactly as Fortnox will. The
// export adds it too, for a row booked before this existed or one whose text
// was edited and lost it. Adding it is idempotent, so the two never double up.

/** Fortnox's limit on a voucher row's text (TransactionInformation). */
const ROW_TEXT_MAX = 100;

const costCenterTag = (code: string): string => `(${code})`;

const hasTag = (text: string, code: string) => text.includes(costCenterTag(code));

/**
 * `text` with the cost centre's tag at the end, unless it is already there.
 * Shortens the text rather than the tag when the two do not fit in `max`, since
 * the tag is the part that says which row this is.
 */
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
  return text.replace(costCenterTag(code), "").replace(/\s{2,}/g, " ").trim();
}

/**
 * The row text after its cost centre changed from `from` to `to`. The old
 * code's tag comes off if it was a local one, and the new code's goes on if it
 * is. A Fortnox cost centre travels as a cost centre and needs no tag.
 */
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
