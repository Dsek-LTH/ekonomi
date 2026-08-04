import { afterEach, describe, expect, it, vi } from "vitest";
import sv from "../../../messages/sv.json";
import en from "../../../messages/en.json";
import {
  EDITABLE_STATUSES,
  EXPENSE_STATUSES,
  SIGNED_STATUSES,
  STATUS_TONE,
  isAttestWithdrawable,
  isEditable,
  isInAttestChain,
  isSigned,
  isSubmittable,
  submitBlocker,
} from "./status";

// The gate that decides whether an utlägg may be sent for attest. The client
// uses it to enable the button and to word the hint; the transition route
// enforces the same rule server-side.
const ready = {
  title: "Fika till mötet",
  purchaseDate: "2026-07-01",
  grossAmount: 250,
  paymentType: "CARD" as const,
  matchedTransactionId: "txn_1",
  submitterHasPayout: false,
  hasReceipt: true,
  allocations: [{ amount: 250, costCenterCode: "SEX01" }],
};

describe("submitBlocker", () => {
  // Only the future-date case pins the clock; the rest read the real one.
  afterEach(() => vi.useRealTimers());

  it("passes a complete card purchase", () => {
    expect(submitBlocker(ready)).toBeNull();
  });

  it("passes a complete reimbursement once payout details exist", () => {
    const reimbursement = {
      ...ready,
      paymentType: "REIMBURSEMENT" as const,
      matchedTransactionId: undefined,
      submitterHasPayout: true,
    };
    expect(submitBlocker(reimbursement)).toBeNull();
  });

  it("blocks an unmatched card purchase", () => {
    expect(submitBlocker({ ...ready, matchedTransactionId: undefined })).toBe("match");
  });

  it("blocks a reimbursement with no account on file", () => {
    expect(
      submitBlocker({
        ...ready,
        paymentType: "REIMBURSEMENT",
        matchedTransactionId: undefined,
        submitterHasPayout: false,
      }),
    ).toBe("payout");
  });

  it("does not ask a card purchase for payout details", () => {
    // The money never leaves the member's own pocket, so their bank account is
    // beside the point.
    expect(submitBlocker({ ...ready, submitterHasPayout: false })).toBeNull();
  });

  it("blocks on each missing detail", () => {
    expect(submitBlocker({ ...ready, title: "   " })).toBe("incomplete");
    expect(submitBlocker({ ...ready, purchaseDate: "" })).toBe("incomplete");
    expect(submitBlocker({ ...ready, grossAmount: 0 })).toBe("incomplete");
    expect(submitBlocker({ ...ready, allocations: [] })).toBe("incomplete");
  });

  it("blocks an utlägg with no receipt", () => {
    // The one missing piece that can't be typed in, so it gets said on its own
    // rather than folded into "komplettera uppgifterna".
    expect(submitBlocker({ ...ready, hasReceipt: false })).toBe("receipt");
  });

  it("blocks a half-typed date", () => {
    // The date field is a mask, so the form can be left mid-entry. Neither of
    // these is the day anything was bought.
    expect(submitBlocker({ ...ready, purchaseDate: "2026" })).toBe("incomplete");
    expect(submitBlocker({ ...ready, purchaseDate: "2026-07" })).toBe("incomplete");
  });

  it("blocks a purchase dated after today, but not one dated today", () => {
    // Nothing has been bought tomorrow. `ready` is dated 1 July, so the clock is
    // pinned to a day after it and the fixture itself stays valid.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T09:00:00Z"));
    expect(submitBlocker({ ...ready, purchaseDate: "2026-08-04" })).toBe("futureDate");
    expect(submitBlocker({ ...ready, purchaseDate: "2027-07-01" })).toBe("futureDate");
    expect(submitBlocker({ ...ready, purchaseDate: "2026-08-03" })).toBeNull();
  });

  it("blocks an eget utlägg handed in after the deadline, on the day after", () => {
    // 60 days is in time, 61 is not — the boundary the rule is written around.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T09:00:00Z"));
    const own = {
      ...ready,
      paymentType: "REIMBURSEMENT" as const,
      matchedTransactionId: undefined,
      submitterHasPayout: true,
    };
    expect(submitBlocker({ ...own, purchaseDate: "2026-06-04" })).toBeNull(); // 60 days
    expect(submitBlocker({ ...own, purchaseDate: "2026-06-03" })).toBe("tooLate"); // 61
  });

  it("says the deadline first, ahead of anything the submitter could fix", () => {
    // Past it there is nothing to fix: sending them to My profile for a payout
    // account, or back for a receipt, only wastes the trip.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T09:00:00Z"));
    expect(
      submitBlocker({
        ...ready,
        paymentType: "REIMBURSEMENT",
        matchedTransactionId: undefined,
        submitterHasPayout: false,
        hasReceipt: false,
        purchaseDate: "2026-01-01",
      }),
    ).toBe("tooLate");
  });

  it("holds no deadline over a sektionskort purchase", () => {
    // The money is already the section's and the transaction is already on the
    // statement — a late one still has to be accounted for, not refused.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T09:00:00Z"));
    expect(submitBlocker({ ...ready, purchaseDate: "2025-01-01" })).toBeNull();
  });

  it("blocks an allocation row with no cost centre picked", () => {
    // The picker starts empty on purpose, so this is the ordinary case rather
    // than a strange one.
    expect(
      submitBlocker({ ...ready, allocations: [{ amount: 250, costCenterCode: "" }] }),
    ).toBe("incomplete");
  });

  it("blocks when the split does not add up to the amount", () => {
    expect(
      submitBlocker({
        ...ready,
        allocations: [
          { amount: 100, costCenterCode: "SEX01" },
          { amount: 100, costCenterCode: "KM01" },
        ],
      }),
    ).toBe("incomplete");
  });

  it("accepts a split across several cost centres that does add up", () => {
    expect(
      submitBlocker({
        ...ready,
        allocations: [
          { amount: 100, costCenterCode: "SEX01" },
          { amount: 150, costCenterCode: "KM01" },
        ],
      }),
    ).toBeNull();
  });

  it("accepts a return, which is a negative amount throughout", () => {
    expect(
      submitBlocker({
        ...ready,
        grossAmount: -250,
        allocations: [{ amount: -250, costCenterCode: "SEX01" }],
      }),
    ).toBeNull();
  });

  it("tolerates rounding in the split but not a real difference", () => {
    const off = (amount: number) =>
      submitBlocker({ ...ready, allocations: [{ amount, costCenterCode: "SEX01" }] });
    expect(off(250.001)).toBeNull(); // float noise from a three-way split
    expect(off(250.01)).toBe("incomplete"); // an öre is a real difference
  });

  it("reports the match before the missing details", () => {
    // Both are wrong here; the hint names the one the submitter has to deal
    // with first.
    expect(submitBlocker({ ...ready, matchedTransactionId: undefined, title: "" })).toBe("match");
  });

  it("has a hint in every language for every blocker it can return", () => {
    for (const blocker of [
      "match",
      "payout",
      "receipt",
      "incomplete",
      "futureDate",
      "tooLate",
    ] as const) {
      expect(sv.expenses.submitBlocker[blocker]).toBeTruthy();
      expect(en.expenses.submitBlocker[blocker]).toBeTruthy();
    }
  });
});

describe("status predicates", () => {
  it("lets an utlägg be edited until it is signed", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("PENDING_APPROVAL")).toBe(true);
    expect(isEditable("CHANGES_REQUESTED")).toBe(true);
    expect(isEditable("APPROVED")).toBe(false);
    expect(isEditable("BOOKED")).toBe(false);
  });

  it("lets the owner send, and re-send, anything not yet attested", () => {
    expect(isSubmittable("DRAFT")).toBe(true);
    expect(isSubmittable("CHANGES_REQUESTED")).toBe(true);
    expect(isSubmittable("PENDING_APPROVAL")).toBe(false); // already sent
    expect(isSubmittable("APPROVED")).toBe(false);
  });

  it("treats attested and beyond as signed", () => {
    expect(isSigned("APPROVED")).toBe(true);
    expect(isSigned("BOOKED")).toBe(true);
    expect(isSigned("EXPORTED")).toBe(true);
    expect(isSigned("DRAFT")).toBe(false);
  });

  it("counts sent-and-beyond as the attest queue, and nothing earlier", () => {
    // What the attest page's "Alla" view shows. A DRAFT nobody has sent is not
    // in anyone's queue, and neither is one sent back for changes.
    expect(isInAttestChain("PENDING_APPROVAL")).toBe(true);
    expect(isInAttestChain("APPROVED")).toBe(true);
    expect(isInAttestChain("EXPORTED")).toBe(true);
    expect(isInAttestChain("DRAFT")).toBe(false);
    expect(isInAttestChain("PENDING_MATCH")).toBe(false);
    expect(isInAttestChain("CHANGES_REQUESTED")).toBe(false);
  });

  it("lets an attester withdraw until the voucher exists", () => {
    expect(isAttestWithdrawable("PENDING_APPROVAL")).toBe(true);
    expect(isAttestWithdrawable("APPROVED")).toBe(true);
    expect(isAttestWithdrawable("BOOKED")).toBe(false);
  });

  it("offers every status in the filter list, with a label in both locales", () => {
    // STATUS_TONE is Record<ExpenseStatus, Tone>, so its keys are the full set
    // by construction — the list the utlägg filter renders has to match it, or
    // a status silently becomes unfilterable.
    expect([...EXPENSE_STATUSES].sort()).toEqual(Object.keys(STATUS_TONE).sort());
    for (const status of EXPENSE_STATUSES) {
      expect(sv.common.status[status]).toBeTruthy();
      expect(en.common.status[status]).toBeTruthy();
    }
  });

  it("keeps editable and signed disjoint", () => {
    // Nothing may be open for edits and part of the records at the same time.
    for (const status of EDITABLE_STATUSES) {
      expect(SIGNED_STATUSES).not.toContain(status);
    }
  });
});
