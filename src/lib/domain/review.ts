// Granskning: the look at a konterat utlägg before it is bokfört in Fortnox.
//
// Two questions, both answered here so the export route, the review queue and
// the review screen cannot give different answers to them:
//
//   who konterade it, and may this viewer bokföra it (the two-person rule)
//   what about it is worth a second look before it is sent (the warnings)
//
// Bokföring is the one step that cannot be undone. Fortnox has no delete for a
// voucher, only a makulering, so the check belongs in front of it.

/** One write to an utlägg's history, as far as these rules care. */
export interface BookingEvent {
  type: string;
  actorId: string | null;
}

/**
 * The kontering as it stands: the latest BOOKED event, and the EDITED ones
 * after it, in order. Null when it has never been konterat.
 *
 * Counted from the latest BOOKED event. An utlägg reopened and konterat again
 * starts over, because the earlier rows are gone.
 *
 * Generic so each caller keeps what it loaded with the events (a name, a
 * date) and the rule for which events count is written once.
 */
export function bookingTrail<E extends { type: string }>(
  events: readonly E[],
): { booked: E; amended: E[] } | null {
  const start = events.findLastIndex((e) => e.type === "BOOKED");
  if (start === -1) return null;
  return {
    booked: events[start],
    amended: events.slice(start + 1).filter((e) => e.type === "EDITED"),
  };
}

/**
 * Everyone who has written this utlägg's kontering: whoever konterade it last,
 * and whoever has amended the rows since. In the order they first did.
 *
 * Amenders count. Otherwise changing one digit in a colleague's kontering
 * would make it yours to bokföra, and the second pair of eyes would be your own.
 */
export function bookedBy(events: readonly BookingEvent[]): string[] {
  const trail = bookingTrail(events);
  if (!trail) return [];
  const ids = [trail.booked, ...trail.amended].flatMap((e) => (e.actorId ? [e.actorId] : []));
  return [...new Set(ids)];
}

/**
 * Why this viewer may not bokföra this utlägg, or null when they may.
 *
 * The rule always holds: whoever konterade it does not bokföra it. It is not a
 * setting, because a second pair of eyes is not something to switch off. Who
 * is exempt is: the roles holding REVIEW_OWN_BOOKING, which is set in
 * Inställningar → Roller, so no role is named here.
 */
export function reviewBlocker(opts: {
  /** canReviewOwnBooking for the viewer. */
  exempt: boolean;
  viewerId: string;
  bookedBy: readonly string[];
}): "ownBooking" | null {
  if (opts.exempt) return null;
  return opts.bookedBy.includes(opts.viewerId) ? "ownBooking" : null;
}

/**
 * What the review screen points out. Each is a message key under
 * `bookkeeping.review.warning`. None of them stops the bokföring: each is
 * something a person may have decided on purpose, and the reviewer is the one
 * looking.
 */
export type ReviewWarning =
  | "outsideFinancialYear"
  | "prefixOnlyText"
  | "inactiveAccount"
  | "inactiveCostCenter"
  | "inactiveProject";

export function reviewWarnings(input: {
  /** ISO date of the voucher. */
  date: string;
  /** The synced financial years. Empty means none have been synced, and then
   *  the date is not something this app can judge. */
  financialYears: readonly { fromDate: string; toDate: string }[];
  description: string;
  /** The fixed start of the voucher text, see the kontering screen. */
  textPrefix: string;
  lines: readonly { account: string; costCenterCode?: string; project?: string }[];
  isActiveAccount: (n: string) => boolean;
  isActiveCostCenter: (code: string) => boolean;
  isActiveProject: (n: string) => boolean;
}): ReviewWarning[] {
  const out: ReviewWarning[] = [];

  const day = input.date.slice(0, 10);
  if (
    input.financialYears.length > 0 &&
    !input.financialYears.some((y) => y.fromDate.slice(0, 10) <= day && day <= y.toDate.slice(0, 10))
  ) {
    out.push("outsideFinancialYear");
  }

  const text = input.description.trim();
  if (!text || text === input.textPrefix.trim()) out.push("prefixOnlyText");

  if (input.lines.some((l) => !input.isActiveAccount(l.account))) out.push("inactiveAccount");
  if (input.lines.some((l) => l.costCenterCode && !input.isActiveCostCenter(l.costCenterCode))) {
    out.push("inactiveCostCenter");
  }
  if (input.lines.some((l) => l.project && !input.isActiveProject(l.project))) {
    out.push("inactiveProject");
  }
  return out;
}

/**
 * The fixed start of an utlägg's voucher text: the submitter's StiL id for a
 * card purchase, "PU <stilid>" for anything the section owes the member.
 * The kontering screen locks it; the review checks whether anything follows it.
 */
export const voucherTextPrefix = (paymentType: string, studentId: string) =>
  paymentType === "CARD" ? studentId : `PU ${studentId}`;
