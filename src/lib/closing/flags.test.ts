import { describe, expect, it } from "vitest";
import type { VoucherEvidence } from "./evidence";
import { flagVouchers } from "./flags";

const year = { fromDate: "2026-01-01", toDate: "2026-12-31" };
const none: VoucherEvidence = { kind: "none" };
const expense = (over: { deadlineWaived?: boolean; ownBooking?: boolean }): VoucherEvidence => ({
  kind: "expense",
  id: "e1",
  reference: "DEK26-0001",
  title: "Kolsyra",
  receipts: 1,
  deadlineWaived: false,
  ownBooking: false,
  agrees: true,
  ...over,
});

const v = (key: string, date: string, amount: number, evidence: VoucherEvidence = none) => ({
  key,
  date,
  amount,
  evidence,
});

describe("flagVouchers", () => {
  it("leaves an ordinary voucher alone", () => {
    expect(flagVouchers([v("A-1", "2026-03-01", 450)], year).size).toBe(0);
  });

  it("flags a voucher dated outside the year", () => {
    expect(flagVouchers([v("A-1", "2027-01-02", 450)], year).get("A-1")).toEqual(["outsideYear"]);
  });

  it("flags both of two vouchers on the same day for the same amount", () => {
    const flags = flagVouchers(
      [v("A-1", "2026-03-01", 450), v("A-2", "2026-03-01", 450), v("A-3", "2026-03-02", 450)],
      year,
    );
    expect(flags.get("A-1")).toEqual(["possibleDuplicate"]);
    expect(flags.get("A-2")).toEqual(["possibleDuplicate"]);
    expect(flags.has("A-3")).toBe(false);
  });

  it("does not call two zero vouchers duplicates", () => {
    const flags = flagVouchers([v("A-1", "2026-03-01", 0), v("A-2", "2026-03-01", 0)], year);
    expect(flags.size).toBe(0);
  });

  it("flags a dispens and an own booking on the utlägg behind a voucher", () => {
    const flags = flagVouchers(
      [v("A-1", "2026-03-01", 450, expense({ deadlineWaived: true, ownBooking: true }))],
      year,
    );
    expect(flags.get("A-1")).toEqual(["deadlineWaived", "ownBooking"]);
  });
});
