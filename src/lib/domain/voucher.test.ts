import { describe, expect, it } from "vitest";
import { voucherBlocker, type VoucherLine } from "./voucher";

// Amounts are öre throughout — that is the point of the rule living here.
const line = (account: string, debit: number, credit: number): VoucherLine => ({
  account,
  debit,
  credit,
});

// A card purchase of 250,00 kr: the bank is credited the full amount, the cost
// account carries it.
const balanced = [line("1930", 0, 25000), line("4010", 25000, 0)];

describe("voucherBlocker", () => {
  it("passes a balanced two-line voucher", () => {
    expect(voucherBlocker(balanced)).toBeNull();
  });

  it("passes a voucher split across several cost accounts", () => {
    expect(
      voucherBlocker([
        line("1930", 0, 25000),
        line("4010", 15000, 0),
        line("5010", 10000, 0),
      ]),
    ).toBeNull();
  });

  it("refuses a single row — one line is not double entry", () => {
    expect(voucherBlocker([line("1930", 0, 25000)])).toBe("twoLines");
    expect(voucherBlocker([])).toBe("twoLines");
  });

  it("refuses a row with no account", () => {
    expect(voucherBlocker([line("1930", 0, 25000), line("", 25000, 0)])).toBe(
      "accountRequired",
    );
  });

  it("treats a blank account as missing, not as an account", () => {
    expect(voucherBlocker([line("1930", 0, 25000), line("   ", 25000, 0)])).toBe(
      "accountRequired",
    );
  });

  it("refuses negative amounts — a return flips the rows, not the sign", () => {
    expect(voucherBlocker([line("1930", 0, -25000), line("4010", -25000, 0)])).toBe(
      "negativeAmounts",
    );
  });

  it("refuses an unbalanced voucher", () => {
    expect(voucherBlocker([line("1930", 0, 25000), line("4010", 24900, 0)])).toBe(
      "unbalanced",
    );
  });

  it("refuses an empty voucher, which balances at zero", () => {
    expect(voucherBlocker([line("1930", 0, 0), line("4010", 0, 0)])).toBe("unbalanced");
  });

  // The reason the rule counts in öre: 0,1 + 0,2 in kronor is not 0,3, so a
  // voucher balanced to the öre could read as unbalanced by a float's width.
  it("balances exactly at öre resolution", () => {
    expect(voucherBlocker([line("1930", 0, 30), line("4010", 10, 0), line("5010", 20, 0)])).toBeNull();
  });

  // A return: the same rows the other way round, and still balanced.
  it("passes a return, which books the rows reversed", () => {
    expect(voucherBlocker([line("1930", 25000, 0), line("4010", 0, 25000)])).toBeNull();
  });
});
