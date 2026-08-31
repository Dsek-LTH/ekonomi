import { describe, expect, it } from "vitest";

import { makeVoucherRow } from "@/components/voucher-editor";
import { costCentreFor, defaultRows, voucherFor } from "./voucher-draft";
import type { IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";

// What decides whether a day of takings is written to the ledger. It lived at
// line 305 of a sixteen-hundred-line component and had no tests at all, which
// is a strange place to keep the arithmetic that posts the section's income.

const settings = {
  zettleClearingAccount: "1580",
  swishClearingAccount: "1585",
  zettleFeeAccount: "6570",
  zettleFeeCostCenterCode: "SEX01",
} as IncomeSettingsRow;

const accounts = [
  { number: "1580", name: "Zettle-fordran" },
  { number: "1585", name: "Swish-fordran" },
  { number: "3010", name: "Försäljning" },
  { number: "3020", name: "Försäljning mat" },
  { number: "6570", name: "Bankkostnader" },
] as AccountRecord[];

const costCenters = [{ code: "SEX01" }, { code: "KM01" }] as CostCenter[];

const label = { source: "Swish", clearingHint: "hint", clearingLocked: "locked" };

const report = (over: Partial<IncomeReportRow> = {}) =>
  ({
    id: "r1",
    source: "SWISH",
    date: "2026-08-11",
    total: 1250,
    costCenterCode: "SEX01",
    defaultCostCenterCode: null,
    duplicateOf: null,
    existingVoucher: null,
    lines: [{ account: "3010", total: 1250 }],
    ...over,
  }) as IncomeReportRow;

const draft = (r: IncomeReportRow, rows = defaultRows(r, settings)) =>
  voucherFor({ report: r, rows, settings, accounts, costCenters, label });

describe("costCentreFor", () => {
  it("prefers the day's own cost centre", () => {
    expect(costCentreFor(report({ costCenterCode: "KM01" }), settings)).toBe("KM01");
  });

  it("falls back to the committee's default", () => {
    // A day fetched before the committee had one would otherwise open blank and
    // refuse to book, with the answer sitting in the settings all along.
    const r = report({ costCenterCode: null, defaultCostCenterCode: "KM01" });
    expect(costCentreFor(r, settings)).toBe("KM01");
  });

  it("sends Zettle's own fees to the fee cost centre", () => {
    // A fee is nobody's committee, so it cannot inherit one.
    const r = report({ source: "ZETTLE_FEE", costCenterCode: null });
    expect(costCentreFor(r, settings)).toBe("SEX01");
  });
});

describe("defaultRows", () => {
  it("gives one row per revenue account, summed", () => {
    const r = report({
      total: 1500,
      lines: [
        { account: "3010", total: 1000 },
        { account: "3020", total: 300 },
        { account: "3010", total: 200 },
      ],
    } as Partial<IncomeReportRow>);
    const rows = defaultRows(r, settings);
    expect(rows.map((x) => [x.account, x.credit])).toEqual([
      ["3010", "1200.00"],
      ["3020", "300.00"],
    ]);
  });

  it("books a net refund as a debit, not a negative credit", () => {
    // A ledger can represent the row the other way round; it cannot represent a
    // negative credit.
    const r = report({ total: -80, lines: [{ account: "3010", total: -80 }] } as Partial<IncomeReportRow>);
    const [row] = defaultRows(r, settings);
    expect(row.debit).toBe("80.00");
    expect(row.credit).toBe("");
  });

  it("drops accounts that came to nothing", () => {
    const r = report({
      lines: [
        { account: "3010", total: 1250 },
        { account: "3020", total: 0 },
      ],
    } as Partial<IncomeReportRow>);
    expect(defaultRows(r, settings).map((x) => x.account)).toEqual(["3010"]);
  });
});

describe("voucherFor", () => {
  it("debits the clearing account for a day that took money", () => {
    const v = draft(report());
    expect(v.clearing).toBe("1585");
    expect(v.locked.debit).toBe(1250);
    expect(v.locked.credit).toBe(0);
    expect(v.balanced).toBe(true);
    expect(v.canBook).toBe(true);
  });

  it("credits it for a fee, which is money leaving", () => {
    const r = report({ source: "ZETTLE_FEE", total: 42, lines: [] } as Partial<IncomeReportRow>);
    const v = draft(r);
    expect(v.clearing).toBe("1580");
    expect(v.locked.credit).toBe(42);
    expect(v.locked.debit).toBe(0);
    expect(v.balanced).toBe(true);
  });

  it("credits it for a day that came to a net refund", () => {
    const r = report({ total: -80, lines: [{ account: "3010", total: -80 }] } as Partial<IncomeReportRow>);
    const v = draft(r);
    expect(v.locked.credit).toBe(80);
    expect(v.balanced).toBe(true);
  });

  it("puts no cost centre on the clearing line", () => {
    // A clearing account is a bank balance, not a dimension of anybody's
    // budget: a cost centre here would make the committee's outcome count the
    // money twice.
    expect(draft(report()).lines[0].costCenterCode).toBeNull();
  });

  it("refuses to book a voucher that does not balance", () => {
    const rows = defaultRows(report(), settings);
    rows[0].credit = "1000.00"; // the day took 1250
    const v = draft(report(), rows);
    expect(v.balanced).toBe(false);
    expect(v.canBook).toBe(false);
    expect(v.difference).toBeCloseTo(250, 2);
  });

  it("refuses an account that is not in the chart", () => {
    // Otherwise it is found by Fortnox, at export, on a voucher this app has
    // already called booked.
    const rows = defaultRows(report(), settings);
    rows[0].account = "9999";
    expect(draft(report(), rows).canBook).toBe(false);
  });

  it("refuses a cost centre that is not in the chart", () => {
    const rows = defaultRows(report(), settings);
    rows[0].costCenterCode = "NOPE";
    expect(draft(report(), rows).canBook).toBe(false);
  });

  it("says so when the clearing account itself is missing from the chart", () => {
    const v = voucherFor({
      report: report(),
      rows: defaultRows(report(), settings),
      settings: { ...settings, swishClearingAccount: "1599" } as IncomeSettingsRow,
      accounts,
      costCenters,
      label,
    });
    expect(v.clearingKnown).toBe(false);
    expect(v.canBook).toBe(false);
  });

  it("refuses a day this database has already booked", () => {
    // A second verifikation is refused by the database anyway; the button
    // should not offer it.
    const v = draft(report({ duplicateOf: { id: "r0", voucherLabel: "A5" } }));
    expect(v.balanced).toBe(true);
    expect(v.canBook).toBe(false);
  });

  it("ignores the editor's spare empty rows", () => {
    // Sent as they are, every day would be blocked on three rows with no
    // account. A row counts as spare only when every field of it is empty:
    // a leftover cost centre is enough to make it a row somebody meant.
    const rows = defaultRows(report(), settings);
    const v = draft(report(), [...rows, makeVoucherRow({})]);
    expect(v.lines).toHaveLength(2); // the clearing row and the one real row
    expect(v.canBook).toBe(true);
  });

  it("does not treat a half-typed row as spare", () => {
    // The stricter half of the same rule: a row carrying only a cost centre is
    // an account somebody has not picked yet, and blocks the voucher rather
    // than being quietly dropped from it.
    const rows = defaultRows(report(), settings);
    const v = draft(report(), [...rows, makeVoucherRow({ costCenterCode: "SEX01" })]);
    expect(v.canBook).toBe(false);
  });
});
