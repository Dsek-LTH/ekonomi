import { describe, expect, it } from "vitest";

import { dayVoucher, lineFindings } from "./voucher-draft";
import type { IncomeLineRow, IncomeReportRow } from "@/lib/data/income";
import type { IncomeSettingsRow } from "@/lib/data/income-config";
import type { AccountRecord, CostCenter } from "@/lib/domain/types";

// What decides whether a day of takings is written to the ledger, and what the
// screen says it will be written as. The same rows and the same refusals as
// the booking route, which is the whole point of it.

const settings = {
  zettleClearingAccount: "1580",
  swishClearingAccount: "1585",
  zettleFeeAccount: "6570",
} as IncomeSettingsRow;

const accounts = [
  { number: "1580", name: "Zettle-fordran" },
  { number: "1585", name: "Swish-fordran" },
  { number: "3000", name: "Försäljning" },
  { number: "3011", name: "Öl" },
  { number: "6570", name: "Bankkostnader" },
] as AccountRecord[];

const costCenters = [
  { code: "CAFE02", active: true, source: "FORTNOX" },
  { code: "SEX03", active: true, source: "LOCAL" },
  { code: "OLD01", active: false, source: "FORTNOX" },
  { code: "SKT02", active: true, source: "FORTNOX" },
] as CostCenter[];

const line = (over: Partial<IncomeLineRow> = {}): IncomeLineRow => ({
  id: "l1",
  kind: "SALE",
  resultUnitId: "cafe",
  unitName: "Caféutskottet",
  name: "Kaffe",
  variant: null,
  account: "3000",
  accountName: "Försäljning",
  costCenterId: "cc-cafe",
  costCenterCode: "CAFE02",
  quantity: 1,
  unitPrice: 100,
  discount: 0,
  total: 100,
  unmatched: false,
  ...over,
});

const report = (lines: IncomeLineRow[], over: Partial<IncomeReportRow> = {}) =>
  ({
    id: "r1",
    source: "ZETTLE",
    date: "2026-11-07",
    total: lines.reduce((s, l) => s + l.total, 0),
    duplicateOf: null,
    existingVoucher: null,
    lines,
    ...over,
  }) as IncomeReportRow;

const voucher = (r: IncomeReportRow) => dayVoucher({ report: r, settings, accounts, costCenters });

describe("dayVoucher", () => {
  it("is one row per account and cost centre, fees debited, the net on clearing", () => {
    const v = voucher(
      report([
        line({ total: 100 }),
        line({ id: "l2", total: 50 }),
        line({
          id: "l3",
          resultUnitId: "sexet",
          account: "3011",
          costCenterCode: "SEX03",
          total: 400,
        }),
        line({
          id: "l4",
          kind: "FEE",
          resultUnitId: null,
          account: "6570",
          costCenterCode: "SKT02",
          total: -7.5,
        }),
      ]),
    );
    expect(v.rows.map((r) => [r.account, r.costCenterCode, r.debit, r.credit])).toEqual([
      ["3000", "CAFE02", 0, 150],
      ["3011", "SEX03", 0, 400],
      ["6570", "SKT02", 7.5, 0],
      ["1580", null, 542.5, 0],
    ]);
    expect(v.totalDebit).toBe(550);
    expect(v.totalCredit).toBe(550);
    expect(v.canBook).toBe(true);
  });

  it("uses the Swish clearing account for a Swish day", () => {
    expect(voucher(report([line()], { source: "SWISH" })).rows.at(-1)?.account).toBe("1585");
  });

  // The bug the per-line cost centre was built to end: a day whose revenue
  // rows had no cost centre could be booked once it counted as edited, and
  // reached Fortnox with none.
  it("refuses to book a line with no cost centre", () => {
    const v = voucher(report([line({ costCenterId: null, costCenterCode: null })]));
    expect(v.blocker).toBe("noCostCenter");
    expect(v.canBook).toBe(false);
  });

  it("refuses a fee line with no cost centre too", () => {
    const v = voucher(
      report([
        line(),
        line({
          id: "f",
          kind: "FEE",
          resultUnitId: null,
          account: "6570",
          costCenterCode: null,
          total: -1,
        }),
      ]),
    );
    expect(v.blocker).toBe("noCostCenter");
  });

  it("refuses an archived cost centre, which Fortnox would reject at export", () => {
    expect(voucher(report([line({ costCenterCode: "OLD01" })])).blocker).toBe("inactiveCostCenter");
  });

  it("books a local cost centre: it travels as text, not as a refusal", () => {
    expect(voucher(report([line({ costCenterCode: "SEX03" })])).canBook).toBe(true);
  });

  it("refuses a sale nobody has given a verksamhet", () => {
    expect(voucher(report([line({ resultUnitId: null, unmatched: true })])).blocker).toBe(
      "unplacedLines",
    );
  });

  it("books a reserv sale that has a verksamhet: unmatched is a finding, not a blocker", () => {
    expect(voucher(report([line({ unmatched: true })])).canBook).toBe(true);
  });

  it("names the fee setting when the fee account is unchosen", () => {
    const v = voucher(
      report([
        line(),
        line({
          id: "f",
          kind: "FEE",
          resultUnitId: null,
          account: "",
          costCenterCode: "SKT02",
          total: -1,
        }),
      ]),
    );
    expect(v.blocker).toBe("noFeeAccount");
  });

  it("refuses a day already booked here", () => {
    expect(
      voucher(report([line()], { duplicateOf: { id: "x", voucherLabel: null } })).blocker,
    ).toBe("alreadyBooked");
  });

  it("refuses when the clearing account is unset or missing from the chart", () => {
    const r = report([line()]);
    expect(
      dayVoucher({
        report: r,
        settings: { ...settings, zettleClearingAccount: null },
        accounts,
        costCenters,
      }).blocker,
    ).toBe("noClearingAccount");
    expect(
      dayVoucher({
        report: r,
        settings: { ...settings, zettleClearingAccount: "1999" },
        accounts,
        costCenters,
      }).blocker,
    ).toBe("unknownClearingAccount");
  });

  it("refuses an account that is not in the chart", () => {
    expect(voucher(report([line({ account: "3999" })])).blocker).toBe("unknownAccount");
  });

  it("ignores a line that came to nothing, cost centre or not", () => {
    const v = voucher(report([line(), line({ id: "z", costCenterCode: null, total: 0 })]));
    expect(v.canBook).toBe(true);
  });
});

describe("dayVoucher with a hand-written kontering", () => {
  const manualRow = (
    over: Partial<NonNullable<IncomeReportRow["manual"]>["rows"][number]> = {},
  ) => ({
    account: "3000",
    accountName: "Försäljning",
    costCenterCode: "CAFE02",
    project: null,
    description: "Kaffe till styrelsen",
    debit: 0,
    credit: 100,
    ...over,
  });
  const withManual = (manual: Partial<NonNullable<IncomeReportRow["manual"]>>) =>
    report([line()], {
      manual: { rows: [manualRow()], stale: false, byName: "Anna", at: null, ...manual },
    });

  it("shows the hand-written rows, then the clearing row at the day's total", () => {
    const v = voucher(withManual({}));
    expect(v.rows.map((r) => [r.account, r.costCenterCode, r.debit, r.credit])).toEqual([
      ["3000", "CAFE02", 0, 100],
      ["1580", null, 100, 0],
    ]);
    expect(v.canBook).toBe(true);
  });

  // The rule the server holds it to: a kontering written before the lines
  // changed is never booked as if nothing had happened.
  it("refuses to book a kontering written before the lines changed", () => {
    expect(voucher(withManual({ stale: true })).blocker).toBe("manualStale");
  });

  it("refuses one that no longer balances against the day's total", () => {
    expect(voucher(withManual({ rows: [manualRow({ credit: 90 })] })).blocker).toBe(
      "manualInvalid",
    );
  });

  it("refuses a result row with no cost centre, or an archived one", () => {
    expect(voucher(withManual({ rows: [manualRow({ costCenterCode: null })] })).blocker).toBe(
      "manualInvalid",
    );
    expect(voucher(withManual({ rows: [manualRow({ costCenterCode: "OLD01" })] })).blocker).toBe(
      "inactiveCostCenter",
    );
  });

  it("refuses a project Fortnox does not have", () => {
    expect(voucher(withManual({ rows: [manualRow({ project: "99" })] })).blocker).toBe(
      "unknownProject",
    );
  });
});

describe("lineFindings", () => {
  it("counts what still needs a person, and names the cost centres worth a word", () => {
    const f = lineFindings(
      report([
        line({ unmatched: true }),
        line({ id: "2", resultUnitId: null, unmatched: true }),
        line({ id: "3", costCenterCode: null }),
        line({ id: "4", costCenterCode: "OLD01" }),
        line({ id: "5", costCenterCode: "SEX03" }),
      ]),
      costCenters,
    );
    expect(f).toEqual({ unplaced: 2, noCostCenter: 1, inactive: ["OLD01"], local: ["SEX03"] });
  });
});
