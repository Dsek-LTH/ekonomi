import { describe, expect, it } from "vitest";
import { voucherBalance, voucherBlocker, type VoucherLine } from "./voucher";

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

  it("refuses a row that names an account and posts nothing to it", () => {
    // The bug this exists to stop: the editors only drop a row that is empty
    // all through, so an account picked and then left behind was a "typed" row
    // — and the rest of the voucher balancing without it made the whole thing
    // bookable. A 0,00 line nobody meant to write went to Fortnox.
    expect(
      voucherBlocker([line("1930", 0, 25000), line("4010", 25000, 0), line("6540", 0, 0)]),
    ).toBe("amountRequired");
  });

  it("refuses an unbalanced voucher", () => {
    expect(voucherBlocker([line("1930", 0, 25000), line("4010", 24900, 0)])).toBe(
      "unbalanced",
    );
  });

  it("refuses an empty voucher by its empty rows, not by its balance", () => {
    // It does balance — at nothing — so "debet ≠ kredit" would be a sentence
    // contradicting the two matching sides in front of the reader. What is
    // actually wrong with it is that no row has an amount, and that is what it
    // is told.
    expect(voucherBlocker([line("1930", 0, 0), line("4010", 0, 0)])).toBe("amountRequired");
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

// Balance is the narrower question, and the booking screens ask it on its own:
// the chip says whether the voucher adds up, the button waits on the blocker.
// These are the cases where the two answers differ — which is where the chip
// used to lie, calling a voucher whose sides met "differs by 0,00 kr".
describe("voucherBalance", () => {
  it("agrees with the blocker on an ordinary voucher", () => {
    expect(voucherBalance(balanced).balanced).toBe(true);
    expect(voucherBlocker(balanced)).toBeNull();
  });

  it("balances even with an account still unpicked", () => {
    const lines = [line("1930", 0, 25000), line("", 25000, 0)];
    expect(voucherBalance(lines).balanced).toBe(true);
    expect(voucherBalance(lines).difference).toBe(0);
    // Balanced, and still not bookable — the two questions, disagreeing.
    expect(voucherBlocker(lines)).toBe("accountRequired");
  });

  it("balances with an untouched row hanging off the end", () => {
    const lines = [...balanced, line("", 0, 0)];
    expect(voucherBalance(lines).balanced).toBe(true);
    expect(voucherBlocker(lines)).toBe("accountRequired");
  });

  it("does not call an empty voucher balanced", () => {
    expect(voucherBalance([line("1930", 0, 0), line("4010", 0, 0)]).balanced).toBe(false);
    expect(voucherBalance([]).balanced).toBe(false);
  });

  it("reports the difference signed, debit less credit", () => {
    expect(voucherBalance([line("1930", 0, 25000), line("4010", 24900, 0)]).difference).toBe(-100);
    expect(voucherBalance([line("1930", 0, 24900), line("4010", 25000, 0)]).difference).toBe(100);
  });

  it("separates a single balanced row from a balanced voucher", () => {
    const lines = [line("1930", 25000, 25000)];
    expect(voucherBalance(lines).balanced).toBe(true);
    expect(voucherBlocker(lines)).toBe("twoLines");
  });
});
