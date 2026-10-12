import { describe, expect, it } from "vitest";

import { BookVoucher, VoucherLineInput } from "./expense";

// A voucher row is built by two screens (the utlägg booking table and the
// income one) and both of them send a cleared text field as null. The schema
// used to accept a string or nothing at all but not null, which refused the
// whole booking over a row nobody had written anything on.
describe("VoucherLineInput's optional text", () => {
  const row = { account: "5010", accountName: "Kontorsmaterial", debit: 12500, credit: 0 };

  it.each([
    ["absent", {}],
    ["null", { description: null }],
    ["empty", { description: "" }],
    ["whitespace", { description: "   " }],
  ])("takes a description that is %s, and means none by it", (_name, extra) => {
    const parsed = VoucherLineInput.parse({ ...row, ...extra });
    expect(parsed.description ?? null).toBeNull();
  });

  it("keeps a description that was actually written", () => {
    expect(VoucherLineInput.parse({ ...row, description: "  Pennor " }).description).toBe("Pennor");
  });

  it("treats the cost centre beside it the same way", () => {
    // The two fields are the same kind of thing, and the bug was that they were
    // spelled differently.
    expect(VoucherLineInput.parse({ ...row, costCenterCode: null }).costCenterCode).toBeNull();
    expect(VoucherLineInput.parse({ ...row, costCenterCode: "" }).costCenterCode).toBeNull();
  });
});

describe("BookVoucher", () => {
  it("accepts the body the booking screen sends", () => {
    // The shape from book-client.tsx: a locked payment row with text, then the
    // typed rows, whose empty fields are null. This is the request that failed.
    const body = {
      expectedUpdatedAt: "2026-05-02T09:14:03.512Z",
      date: "2026-05-01",
      description: "Kontorsmaterial",
      lines: [
        {
          account: "2890",
          accountName: "Skulder till medlemmar",
          description: "Privat utlägg",
          costCenterCode: null,
          debit: 0,
          credit: 12500,
        },
        {
          account: "5010",
          accountName: "Kontorsmaterial",
          description: null,
          costCenterCode: "SKT01",
          debit: 12500,
          credit: 0,
        },
      ],
    };
    expect(BookVoucher.safeParse(body).success).toBe(true);
  });

  it("refuses a booking that does not say which version it was made against", () => {
    // Without it there is nothing to tell a colleague's save from ours, and the
    // later one would quietly win.
    expect(BookVoucher.safeParse({ lines: [] }).success).toBe(false);
  });
});
