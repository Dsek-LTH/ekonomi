import { describe, expect, it } from "vitest";

// The rows every export sends Fortnox. A cost centre Fortnox cannot take must never travel as one:
// it gets the whole voucher or supplier invoice rejected (the SEX-ALKO levfaktura did).

import { supplierInvoiceRows, voucherRows } from "./rows";

const fortnox = { code: "SEX01", source: "FORTNOX", active: true };
const local = { code: "SEX-ALKO", source: "LOCAL", active: true };
const retired = { code: "SEX09", source: "FORTNOX", active: false };

const line = (costCenterCode: string | null, description: string | null = "Öl") => ({
  account: "4010",
  debit: 12_000,
  credit: 0,
  costCenterCode,
  project: null,
  description,
});

describe("supplierInvoiceRows", () => {
  const register = new Map([fortnox, local, retired].map((c) => [c.code, c]));

  it("sends a cost centre Fortnox has and has active", () => {
    const [row] = supplierInvoiceRows([line("SEX01")], register);
    expect(row).toMatchObject({ costCenter: "SEX01", text: "Öl", debit: 120, account: 4010 });
  });

  it("puts a local one in the row text instead", () => {
    const [row] = supplierInvoiceRows([line("SEX-ALKO")], register);
    expect(row.costCenter).toBeUndefined();
    expect(row.text).toBe("Öl (SEX-ALKO)");
  });

  it("does not tag a row twice", () => {
    const [row] = supplierInvoiceRows([line("SEX-ALKO", "Öl (SEX-ALKO)")], register);
    expect(row.text).toBe("Öl (SEX-ALKO)");
  });

  it("keeps a deactivated one and an unknown code out of the cost centre too", () => {
    const rows = supplierInvoiceRows([line("SEX09"), line("NOPE")], register);
    expect(rows.map((r) => r.costCenter)).toEqual([undefined, undefined]);
    expect(rows.map((r) => r.text)).toEqual(["Öl (SEX09)", "Öl (NOPE)"]);
  });

  it("leaves a row with no cost centre alone", () => {
    const [row] = supplierInvoiceRows([line(null, null)], register);
    expect(row).toMatchObject({ costCenter: undefined, text: undefined });
  });
});

describe("voucherRows", () => {
  const voucherLine = (costCenter: typeof fortnox | null) => ({
    account: "4010",
    debit: 12_000,
    credit: 0,
    description: "Öl",
    costCenter,
  });

  it("follows the same rule as a supplier invoice", () => {
    const rows = voucherRows([voucherLine(fortnox), voucherLine(local), voucherLine(null)]);
    expect(rows.map((r) => [r.costCenter, r.description])).toEqual([
      ["SEX01", "Öl"],
      [undefined, "Öl (SEX-ALKO)"],
      [undefined, "Öl"],
    ]);
  });
});
