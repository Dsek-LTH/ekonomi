import { describe, expect, it } from "vitest";

import { clearingRow, isResultAccount, manualVoucherBlocker, voucherBasis } from "./manual-voucher";

const line = (account: string, costCenterId: string | null, total: number) => ({
  account,
  costCenterId,
  total,
});

describe("voucherBasis", () => {
  const lines = [line("3000", "cafe", 1000), line("3011", "pub", 500), line("6570", "fee", -30)];
  const total = 1470;

  it("is the same for lines that give the same voucher, in any order", () => {
    expect(voucherBasis([...lines].reverse(), total)).toBe(voucherBasis(lines, total));
    // Split differently across lines, same rows.
    expect(
      voucherBasis(
        [line("3000", "cafe", 400), line("3000", "cafe", 600), ...lines.slice(1)],
        total,
      ),
    ).toBe(voucherBasis(lines, total));
  });

  it("changes when a line's account, cost centre or amount does", () => {
    const base = voucherBasis(lines, total);
    expect(voucherBasis([line("3001", "cafe", 1000), ...lines.slice(1)], total)).not.toBe(base);
    expect(voucherBasis([line("3000", "event", 1000), ...lines.slice(1)], total)).not.toBe(base);
    expect(voucherBasis([line("3000", "cafe", 900), ...lines.slice(1)], 1370)).not.toBe(base);
  });
});

describe("manualVoucherBlocker", () => {
  const row = (account: string, costCenter: string | null, debit: number, credit: number) => ({
    account,
    costCenter,
    debit,
    credit,
  });

  it("passes rows that balance against the day's total", () => {
    // Total 1000 in: the clearing row debits 1000, these credit it.
    expect(
      manualVoucherBlocker([row("3000", "cafe", 0, 600), row("3011", "pub", 0, 400)], 1000),
    ).toBeNull();
  });

  it("refuses a result row with no cost centre, and allows a balance row without one", () => {
    expect(manualVoucherBlocker([row("3000", null, 0, 1000)], 1000)).toBe("costCenterRequired");
    expect(
      manualVoucherBlocker([row("3000", "cafe", 0, 1100), row("2890", null, 100, 0)], 1000),
    ).toBeNull();
  });

  it("refuses rows that do not balance with the clearing row", () => {
    expect(manualVoucherBlocker([row("3000", "cafe", 0, 900)], 1000)).toBe("unbalanced");
  });

  it("refuses an empty kontering, a row without account, amount, or with a negative one", () => {
    expect(manualVoucherBlocker([], 1000)).toBe("noRows");
    expect(manualVoucherBlocker([row("", "cafe", 0, 1000)], 1000)).toBe("accountRequired");
    expect(manualVoucherBlocker([row("3000", "cafe", 0, 0)], 1000)).toBe("amountRequired");
    expect(manualVoucherBlocker([row("3000", "cafe", 0, -1000)], 1000)).toBe("negativeAmounts");
  });

  it("balances a day of net refunds the other way round", () => {
    expect(manualVoucherBlocker([row("3000", "cafe", 500, 0)], -500)).toBeNull();
  });
});

describe("clearingRow", () => {
  it("debits what came in, credits a net refund, and is nothing on a zero day", () => {
    expect(clearingRow(1000)).toEqual({ debit: 1000, credit: 0 });
    expect(clearingRow(-500)).toEqual({ debit: 0, credit: 500 });
    expect(clearingRow(0)).toBeNull();
  });
});

describe("isResultAccount", () => {
  it("is class 3 to 8", () => {
    expect(["3000", "6570", "8999"].every(isResultAccount)).toBe(true);
    expect(["1580", "2890", "9000", ""].some(isResultAccount)).toBe(false);
  });
});
