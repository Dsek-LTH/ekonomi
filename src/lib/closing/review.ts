// Reviews are append-only (prisma/schema/closing.prisma): a voucher's standing is its latest review held against what it says now. A review of a different version is history and does not count.
import type { Capability } from "@/lib/domain/types";
import { canAuditReview, canBookkeep } from "@/lib/domain/permissions";

export const REVIEW_PASSES = ["PREPARER", "AUDITOR"] as const;
export type ReviewPass = (typeof REVIEW_PASSES)[number];

export const REVIEW_STATUSES = ["OK", "QUESTION", "REMARK"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const REVIEW_PICKS = ["unreviewed", "changed", ...REVIEW_STATUSES] as const;
export type ReviewPick = (typeof REVIEW_PICKS)[number];

export interface ReviewRecord {
  pass: ReviewPass;
  status: ReviewStatus;
  contentHash: string;
  reviewedAt: string;
  reviewedBy: string | null;
}

export type ReviewState =
  | { state: "unreviewed" }
  | { state: "changed"; previous: ReviewRecord }
  | { state: "reviewed"; review: ReviewRecord };

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

/** Done: passed, or given an anmärkning (a finding, not an open question). */
export const isSettled = (s: ReviewState) =>
  s.state === "reviewed" && s.review.status !== "QUESTION";

/** The revisor pass if they are a revisor, otherwise the treasury's; null if neither. */
export function reviewPassFor(caps: readonly Capability[]): ReviewPass | null {
  if (canAuditReview(caps)) return "AUDITOR";
  if (canBookkeep(caps)) return "PREPARER";
  return null;
}
