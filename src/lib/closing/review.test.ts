import { describe, expect, it } from "vitest";
import { DEFAULT_ROLE_CAPABILITIES } from "@/lib/server/authority-defaults";
import type { Role } from "@/lib/domain/types";
import { currentReview, isSettled, reviewPassFor, type ReviewRecord } from "./review";

const review = (over: Partial<ReviewRecord>): ReviewRecord => ({
  pass: "AUDITOR",
  status: "OK",
  contentHash: "h1",
  reviewedAt: "2027-02-01T10:00:00.000Z",
  reviewedBy: "Rebecka Vik",
  ...over,
});

const caps = (role: Role) =>
  DEFAULT_ROLE_CAPABILITIES.filter((r) => r.role === role).map((r) => r.capability);

describe("currentReview", () => {
  it("is unreviewed with no review in that pass", () => {
    expect(currentReview([review({ pass: "PREPARER" })], "AUDITOR", "h1")).toEqual({
      state: "unreviewed",
    });
  });

  it("takes the latest review in the pass", () => {
    const s = currentReview(
      [
        review({ status: "QUESTION", reviewedAt: "2027-02-01T10:00:00.000Z" }),
        review({ status: "OK", reviewedAt: "2027-02-03T10:00:00.000Z" }),
      ],
      "AUDITOR",
      "h1",
    );
    expect(s).toMatchObject({ state: "reviewed", review: { status: "OK" } });
  });

  it("does not count a review of a different version of the voucher", () => {
    // Passed, then changed in Fortnox (or the number reused) and synced.
    const s = currentReview([review({ contentHash: "h1" })], "AUDITOR", "h2");
    expect(s).toMatchObject({ state: "changed", previous: { contentHash: "h1" } });
    expect(isSettled(s)).toBe(false);
  });

  it("settles on a pass or an anmärkning, not on an open question", () => {
    expect(isSettled(currentReview([review({ status: "OK" })], "AUDITOR", "h1"))).toBe(true);
    expect(isSettled(currentReview([review({ status: "REMARK" })], "AUDITOR", "h1"))).toBe(true);
    expect(isSettled(currentReview([review({ status: "QUESTION" })], "AUDITOR", "h1"))).toBe(
      false,
    );
  });
});

describe("reviewPassFor", () => {
  it("puts the revisor in the auditor's pass and the treasury in its own", () => {
    expect(reviewPassFor(caps("REVISOR"))).toBe("AUDITOR");
    expect(reviewPassFor(caps("SKATTMASTARE"))).toBe("PREPARER");
    expect(reviewPassFor(caps("SKATTFORMAN"))).toBe("PREPARER");
  });

  it("gives everybody else no pass at all", () => {
    expect(reviewPassFor(caps("RESULTATANSVARIG"))).toBeNull();
    expect(reviewPassFor(caps("ORDINARIE"))).toBeNull();
  });
});
