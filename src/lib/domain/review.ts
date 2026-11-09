// Granskning: the look at a konterat utlägg before it is bokfört in Fortnox. Answers who konterade it
// and whether this viewer may bokföra it (two-person rule), and what deserves a second look
// (warnings). Bokföring cannot be undone (Fortnox only has makulering), so the check goes in front.

export interface BookingEvent {
  type: string;
  actorId: string | null;
}

/** The kontering as it stands: the latest BOOKED event and the EDITED ones after it, in order. Null when never konterat. Generic so callers keep what they loaded with the events. */
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

/** Everyone who has written this utlägg's kontering: last konterare and later amenders, in order of first appearance. Amenders count, or changing one digit would make it yours to bokföra. */
export function bookedBy(events: readonly BookingEvent[]): string[] {
  const trail = bookingTrail(events);
  if (!trail) return [];
  const ids = [trail.booked, ...trail.amended].flatMap((e) => (e.actorId ? [e.actorId] : []));
  return [...new Set(ids)];
}

/** Why this viewer may not bokföra this utlägg, or null. Whoever konterade it does not bokföra it. Exempt are the roles holding REVIEW_OWN_BOOKING (Inställningar → Roller). */
export function reviewBlocker(opts: {
  exempt: boolean;
  viewerId: string;
  bookedBy: readonly string[];
}): "ownBooking" | null {
  if (opts.exempt) return null;
  return opts.bookedBy.includes(opts.viewerId) ? "ownBooking" : null;
}

/** What the review screen points out, as message keys under `bookkeeping.review.warning`. None stops the bokföring. */
export type ReviewWarning =
  | "outsideFinancialYear"
  | "prefixOnlyText"
  | "inactiveAccount"
  | "inactiveCostCenter"
  | "inactiveProject";

export function reviewWarnings(input: {
  date: string;
  /** The synced financial years. Empty means none synced, so the date cannot be judged. */
  financialYears: readonly { fromDate: string; toDate: string }[];
  description: string;
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
    !input.financialYears.some(
      (y) => y.fromDate.slice(0, 10) <= day && day <= y.toDate.slice(0, 10),
    )
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

/** The fixed start of an utlägg's voucher text: the submitter's StiL id for a card purchase, "PU <stilid>" for anything owed to the member. The kontering screen locks it. */
export const voucherTextPrefix = (paymentType: string, studentId: string) =>
  paymentType === "CARD" ? studentId : `PU ${studentId}`;
