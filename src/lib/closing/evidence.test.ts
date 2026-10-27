import { describe, expect, it } from "vitest";
import {
  evidenceFor,
  indexAppVouchers,
  parseVoucherKey,
  voucherKey,
  type AppVoucher,
} from "./evidence";

const expense = (number: number, debit: number, id = `e${number}`): AppVoucher => ({
  series: "A",
  number,
  debit,
  source: {
    kind: "expense",
    id,
    reference: `DEK26-${number}`,
    title: "Kolsyra",
    receipts: 1,
    deadlineWaived: false,
    ownBooking: false,
  },
});

describe("voucher keys", () => {
  it("round-trip", () => {
    expect(parseVoucherKey(voucherKey("A", 12))).toEqual({ series: "A", number: 12 });
  });

  it("refuse anything that is not one", () => {
    expect(parseVoucherKey("A12")).toBeNull();
    expect(parseVoucherKey("A-")).toBeNull();
    expect(parseVoucherKey("../A-1")).toBeNull();
  });
});

describe("evidenceFor", () => {
  it("finds the utlägg behind a voucher the app exported", () => {
    const index = indexAppVouchers([expense(12, 45000)]);
    expect(evidenceFor({ series: "A", number: 12, debit: 45000 }, index)).toMatchObject({
      kind: "expense",
      id: "e12",
      agrees: true,
    });
  });

  it("has nothing for a voucher made in Fortnox", () => {
    const index = indexAppVouchers([expense(12, 45000)]);
    expect(evidenceFor({ series: "A", number: 13, debit: 100 }, index)).toEqual({ kind: "none" });
  });

  it("does not vouch for a number Fortnox has given to a different voucher", () => {
    // A-12 was exported for 450 kr, deleted in Fortnox, and the number reused.
    const index = indexAppVouchers([expense(12, 45000)]);
    expect(evidenceFor({ series: "A", number: 12, debit: 9900 }, index)).toMatchObject({
      kind: "expense",
      agrees: false,
    });
  });

  it("picks the export that agrees when a number was used twice", () => {
    const index = indexAppVouchers([expense(12, 45000, "old"), expense(12, 9900, "new")]);
    expect(evidenceFor({ series: "A", number: 12, debit: 9900 }, index)).toMatchObject({
      id: "new",
      agrees: true,
    });
  });
});
