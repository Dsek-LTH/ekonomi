// A local cost centre (CostCenterSource in the schema) is never sent to Fortnox, which rejects the
// voucher if it is named. Its code goes into the row text instead: "Öl till pub (SEX-ALKO)". Written
// while booking and again at export (idempotent) for rows booked earlier or whose text lost it.
// Every export decides which cost centre goes as one through `sendableCostCenter`, so none forgets.

/** Fortnox's limit on a row's text (TransactionInformation), on a voucher and a supplier invoice alike. */
export const ROW_TEXT_MAX = 100;

/** What an export knows about a row's cost centre. Null when the code is not in the register at all. */
export interface ExportCostCenter {
  code: string;
  source: string;
  active: boolean;
}

/**
 * The code to send Fortnox as the row's cost centre, or undefined. Only one Fortnox has and has
 * active: a local one, a deactivated one or a code the register does not know gets the whole
 * voucher or invoice rejected.
 */
export function sendableCostCenter(cc: ExportCostCenter | null | undefined): string | undefined {
  return cc?.source === "FORTNOX" && cc.active ? cc.code : undefined;
}

/**
 * A row as Fortnox takes it: the cost centre when it may go (`sendableCostCenter`), otherwise its
 * code tagged onto the text so the row still says where it belongs. `code` is the row's own,
 * `cc` what the register says about it (null when it does not know the code).
 */
export function exportRowCostCenter(
  code: string | null | undefined,
  cc: ExportCostCenter | null | undefined,
  text: string,
): { costCenter: string | undefined; text: string } {
  const costCenter = sendableCostCenter(cc);
  if (costCenter || !code) return { costCenter, text };
  return { costCenter: undefined, text: withCostCenterTag(text, code) };
}

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
