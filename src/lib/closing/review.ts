// Where a voucher stands in each pass of the bokslut review.
//
// Reviews are append-only rows (see prisma/schema/closing.prisma), so a
// voucher's standing in a pass is its latest review there, held against what
// the voucher says now. A review of a different version, one taken before the
// voucher was changed in Fortnox or before its number was reused, is history:
// it is shown, and it does not count.
import type { Capability } from "@/lib/domain/types";
import { canAuditReview, canBookkeep } from "@/lib/domain/permissions";

export const REVIEW_PASSES = ["PREPARER", "AUDITOR"] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export const REVIEW_STATUSES = ["OK", "QUESTION", "REMARK"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** What the list's review filter offers: every standing a voucher can have. */
export const REVIEW_PICKS = ["unreviewed", "changed", ...REVIEW_STATUSES] as const;
export type ReviewPick = (typeof REVIEW_PICKS)[number];

export interface ReviewRecord {
  pass: ReviewPass;
  status: ReviewStatus;
  contentHash: string;
  /** ISO timestamp. */
  reviewedAt: string;
  reviewedBy: string | null;
}

export type ReviewState =
  | { state: "unreviewed" }
  /** Reviewed, but a different version of the voucher than the one there now. */
  | { state: "changed"; previous: ReviewRecord }
  | { state: "reviewed"; review: ReviewRecord };

/** The voucher's standing in one pass, from every review it has had. */
export function currentReview(
  records: readonly ReviewRecord[],
  pass: ReviewPass,
  contentHash: string,
): ReviewState {
  let latest: ReviewRecord | undefined;
  for (const r of records) {
    if (r.pass === pass && (!latest || r.reviewedAt > latest.reviewedAt)) latest = r;
  }
  if (!latest) return { state: "unreviewed" };
  if (latest.contentHash !== contentHash) return { state: "changed", previous: latest };
  return { state: "reviewed", review: latest };
}

/**
 * Whether the voucher is done with in this pass: passed, or given an
 * anmärkning, which is a finding rather than an open question. A question is
 * still waiting on an answer, and a changed voucher waits on a new look.
 */
export const isSettled = (s: ReviewState) =>
  s.state === "reviewed" && s.review.status !== "QUESTION";

/**
 * Which pass this person reviews in, or null if they review in neither.
 *
 * A revisor's, if they hold that: somebody who has been made a revisor is
 * reviewing as one, whatever else they can do. Otherwise the treasury's, for
 * whoever works the books.
 */
export function reviewPassFor(caps: readonly Capability[]): ReviewPass | null {
  if (canAuditReview(caps)) return "AUDITOR";
  if (canBookkeep(caps)) return "PREPARER";
  return null;
}
