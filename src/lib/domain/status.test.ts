import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import svCommon from "../../../messages/sv/common.json";
import svExpenses from "../../../messages/sv/expenses.json";
import enCommon from "../../../messages/en/common.json";
import enExpenses from "../../../messages/en/expenses.json";
import type { PaymentType } from "@/lib/domain/types";

const sv = { common: svCommon, expenses: svExpenses };
const en = { common: enCommon, expenses: enExpenses };
import {
  EDITABLE_STATUSES,
  EXPENSE_STATUSES,
  SIGNED_STATUSES,
  PAYMENT_CLASSES,
  PAYMENT_TEXT,
  STATUS_TONE,
  TONE_CLASSES,
  isAttestWithdrawable,
  isEditable,
  isRecallable,
  isSigned,
  isSubmittable,
  submitBlocker,
} from "./status";

/** The day these tests are asked on. The whole suite is asked on one day so the literal fixture dates do not age past the 60-day deadline. */
const TODAY = new Date("2026-08-03T09:00:00Z");

const ready = {
  title: "Fika till mötet",
  purchaseDate: "2026-07-01",
  grossAmount: 250,
  paymentType: "CARD" as const,
  matchedTransactionId: "txn_1",
  submitterHasPayout: false,
  hasReceipt: true,
  deadlineWaived: false,
  allocations: [{ amount: 250, costCenterCode: "SEX01" }],
};

describe("submitBlocker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
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
    expect(submitBlocker({ ...ready, submitterHasPayout: false })).toBeNull();
  });

  it("blocks on each missing detail", () => {
    expect(submitBlocker({ ...ready, title: "   " })).toBe("incomplete");
    expect(submitBlocker({ ...ready, purchaseDate: "" })).toBe("incomplete");
    expect(submitBlocker({ ...ready, grossAmount: 0 })).toBe("incomplete");
    expect(submitBlocker({ ...ready, allocations: [] })).toBe("incomplete");
  });

  it("blocks an utlägg with no receipt", () => {
    // The one missing piece that can't be typed in, so it is named on its own.
    expect(submitBlocker({ ...ready, hasReceipt: false })).toBe("receipt");
  });

  it("asks a milersättning for its journey, not for a receipt", () => {
    // A mileage claim has no receipt: the check is whether the readings describe a journey.
    const mileage = {
      ...ready,
      paymentType: "MILEAGE" as const,
      matchedTransactionId: undefined,
      submitterHasPayout: true,
      hasReceipt: false,
      mileageBlocker: null,
    };
    expect(submitBlocker(mileage)).toBeNull();
    expect(submitBlocker({ ...mileage, mileageBlocker: "notForward" })).toBe("mileage");
  });

  it("asks a milersättning for a payout account, like any out-of-pocket claim", () => {
    // The section owes the petrol as it owes a receipt, and cannot pay either without an account number.
    expect(
      submitBlocker({
        ...ready,
        paymentType: "MILEAGE" as const,
        matchedTransactionId: undefined,
        hasReceipt: false,
        mileageBlocker: null,
        submitterHasPayout: false,
      }),
    ).toBe("payout");
  });

  it("blocks a half-typed date", () => {
    // The date field is a mask, so the form can be left mid-entry.
    expect(submitBlocker({ ...ready, purchaseDate: "2026" })).toBe("incomplete");
    expect(submitBlocker({ ...ready, purchaseDate: "2026-07" })).toBe("incomplete");
  });

  it("blocks a purchase dated after today, but not one dated today", () => {
    expect(submitBlocker({ ...ready, purchaseDate: "2026-08-04" })).toBe("futureDate");
    expect(submitBlocker({ ...ready, purchaseDate: "2027-07-01" })).toBe("futureDate");
    expect(submitBlocker({ ...ready, purchaseDate: "2026-08-03" })).toBeNull();
  });

  it("blocks an eget utlägg handed in after the deadline, on the day after", () => {
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
    // Past the deadline there is nothing to fix, so the deadline is reported first.
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

  it("holds the deadline over a milersättning too", () => {
    // Milersättning is as uncheckable when stale as a stale receipt, refused on the same day.
    const drove = {
      ...ready,
      paymentType: "MILEAGE" as const,
      matchedTransactionId: undefined,
      submitterHasPayout: true,
      hasReceipt: false,
      mileageBlocker: null,
    };
    expect(submitBlocker({ ...drove, purchaseDate: "2026-06-04" })).toBeNull(); // 60 days
    expect(submitBlocker({ ...drove, purchaseDate: "2026-06-03" })).toBe("tooLate"); // 61
  });

  it("lets a dispens through the deadline, and nothing else", () => {
    // A dispens lifts exactly the deadline: other blockers still apply.
    const late = {
      ...ready,
      paymentType: "REIMBURSEMENT" as const,
      matchedTransactionId: undefined,
      submitterHasPayout: true,
      purchaseDate: "2026-01-01",
    };
    expect(submitBlocker(late)).toBe("tooLate");
    expect(submitBlocker({ ...late, deadlineWaived: true })).toBeNull();
    expect(submitBlocker({ ...late, deadlineWaived: true, submitterHasPayout: false })).toBe(
      "payout",
    );
  });

  it("holds no deadline over a sektionskort purchase", () => {
    // The money is already on the statement: a late one is accounted for, not refused.
    expect(submitBlocker({ ...ready, purchaseDate: "2025-01-01" })).toBeNull();
  });

  it("blocks an allocation row with no cost centre picked", () => {
    expect(submitBlocker({ ...ready, allocations: [{ amount: 250, costCenterCode: "" }] })).toBe(
      "incomplete",
    );
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
    // Both are wrong here; the hint names the one to deal with first.
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
  it("lets an utlägg be edited while it is the submitter's own", () => {
    expect(isEditable("DRAFT")).toBe(true);
    expect(isEditable("CHANGES_REQUESTED")).toBe(true);
  });

  it("does not, while it is out for attest", () => {
    // It must hold still while somebody reads it; the way back is to recall it.
    expect(isEditable("PENDING_APPROVAL")).toBe(false);
    expect(isRecallable("PENDING_APPROVAL")).toBe(true);
  });

  it("does not, once it is signed", () => {
    expect(isEditable("APPROVED")).toBe(false);
    expect(isEditable("BOOKED")).toBe(false);
    expect(isEditable("EXPORTED")).toBe(false);
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

  it("lets an attester withdraw until the voucher exists", () => {
    expect(isAttestWithdrawable("PENDING_APPROVAL")).toBe(true);
    expect(isAttestWithdrawable("APPROVED")).toBe(true);
    expect(isAttestWithdrawable("BOOKED")).toBe(false);
  });

  it("offers every status in the filter list, with a label in both locales", () => {
    // The utlägg filter's list must match STATUS_TONE's full key set, or a status becomes unfilterable.
    expect([...EXPENSE_STATUSES].sort()).toEqual(Object.keys(STATUS_TONE).sort());
    for (const status of EXPENSE_STATUSES) {
      expect(sv.common.status[status]).toBeTruthy();
      expect(en.common.status[status]).toBeTruthy();
    }
  });

  it("gives every payment type its own colour, and a word in both locales", () => {
    // Status and payment tones must cover every key, and each be distinct.
    const PAYMENT_TYPES = Object.keys(PAYMENT_CLASSES) as PaymentType[];
    for (const type of PAYMENT_TYPES) {
      expect(PAYMENT_CLASSES[type]).toBeTruthy();
      expect(PAYMENT_TEXT[type]).toBeTruthy();
      expect(sv.common.payment[type].label).toBeTruthy();
      expect(en.common.payment[type].label).toBeTruthy();
    }
    expect(new Set(Object.values(PAYMENT_CLASSES)).size).toBe(PAYMENT_TYPES.length);
    expect(new Set(Object.values(PAYMENT_TEXT)).size).toBe(PAYMENT_TYPES.length);
    // None borrows a status tone: a row shows both (app/globals.css).
    for (const cls of Object.values(PAYMENT_CLASSES)) {
      for (const tone of Object.values(TONE_CLASSES)) {
        expect(cls).not.toBe(tone);
      }
    }
  });

  it("keeps editable and signed disjoint", () => {
    for (const status of EDITABLE_STATUSES) {
      expect(SIGNED_STATUSES).not.toContain(status);
    }
  });
});

describe("isRecallable", () => {
  it("lets the submitter take back one that is only waiting", () => {
    expect(isRecallable("PENDING_APPROVAL")).toBe(true);
  });

  it("does not, once somebody has actually attested it", () => {
    // Then it is bookkeeping's to reopen (`return_approved`).
    expect(isRecallable("APPROVED")).toBe(false);
    expect(isRecallable("BOOKED")).toBe(false);
    expect(isRecallable("EXPORTED")).toBe(false);
  });

  it("has nothing to take back from one already in the submitter's hands", () => {
    expect(isRecallable("DRAFT")).toBe(false);
    expect(isRecallable("CHANGES_REQUESTED")).toBe(false);
  });
});
