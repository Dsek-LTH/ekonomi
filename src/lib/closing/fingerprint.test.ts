import { describe, expect, it } from "vitest";
import { voucherFingerprint, type FingerprintRow } from "./fingerprint";

const row = (account: string, debit: number, credit: number): FingerprintRow => ({
  account,
  costCenterCode: "SEX01",
  text: null,
  debit,
  credit,
});

const voucher = {
  date: "2026-03-01",
  description: "Kolsyra",
  rows: [row("4010", 45000, 0), row("2440", 0, 45000)],
};

describe("voucherFingerprint", () => {
  it("is the same for the same voucher, whatever order its rows come in", () => {
    const reversed = { ...voucher, rows: [...voucher.rows].reverse() };
    expect(voucherFingerprint(reversed)).toBe(voucherFingerprint(voucher));
  });

  it("changes when a number is reused for a different voucher", () => {
    const other = { ...voucher, rows: [row("4010", 9900, 0), row("1930", 0, 9900)] };
    expect(voucherFingerprint(other)).not.toBe(voucherFingerprint(voucher));
  });

  it("changes with the date, the text, the account or the cost centre", () => {
    const base = voucherFingerprint(voucher);
    expect(voucherFingerprint({ ...voucher, date: "2026-03-02" })).not.toBe(base);
    expect(voucherFingerprint({ ...voucher, description: "Kolsyra 2" })).not.toBe(base);
    expect(
      voucherFingerprint({ ...voucher, rows: [row("4011", 45000, 0), row("2440", 0, 45000)] }),
    ).not.toBe(base);
    expect(
      voucherFingerprint({
        ...voucher,
        rows: [{ ...row("4010", 45000, 0), costCenterCode: "AKT01" }, row("2440", 0, 45000)],
      }),
    ).not.toBe(base);
  });

  it("treats a missing cost centre and a missing text alike however they arrive", () => {
    const a = { ...voucher, rows: [{ ...row("4010", 1, 0), costCenterCode: null }] };
    const b = { ...voucher, rows: [{ ...row("4010", 1, 0), costCenterCode: null, text: null }] };
    expect(voucherFingerprint(a)).toBe(voucherFingerprint(b));
  });
});
