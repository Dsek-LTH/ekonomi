import { describe, expect, it } from "vitest";
import type { LedgerReport, ReportAccount, ReportSection } from "@/lib/ledger/report-shape";
import { reportToCsv } from "./report-view";
import type { ResultColumn } from "./report-types";

// Pins the CSV the Utfall page downloads, column for column, across the
// options that change its shape. Written before reportToCsv was simplified, so
// the simplification had to produce the same bytes.

const t = (key: string) => `[${key}]`;

const account = (n: string, amount: number, extra: Partial<ReportAccount> = {}): ReportAccount => ({
  account: n,
  accountName: `Konto ${n}`,
  amount,
  opening: null,
  closing: null,
  comparison: null,
  accumulated: null,
  prior: null,
  priorAccumulated: null,
  ...extra,
});

const section = (key: string, accounts: ReportAccount[], extra: Partial<ReportSection> = {}): ReportSection => ({
  key,
  accounts,
  total: accounts.reduce((s, a) => s + a.amount, 0),
  opening: null,
  closing: null,
  comparison: null,
  accumulated: null,
  prior: null,
  priorAccumulated: null,
  ...extra,
});

const result: LedgerReport = {
  kind: "RESULT",
  group: "SPECIFIED",
  groups: [
    {
      costCenterCode: "SEX01",
      costCenterName: "Sittningar",
      sections: [
        section(
          "income",
          [account("3011", 1200.5, { comparison: 1000, accumulated: 2400, prior: 900, priorAccumulated: 1800 })],
          { comparison: 1000, accumulated: 2400, prior: 900, priorAccumulated: 1800 },
        ),
        section("costs", [
          account("4010", -300.25, { comparison: null, accumulated: -600, prior: null }),
          account("6990", -10, { accountName: 'Övrigt; "diverse"' }),
        ]),
      ],
      total: 890.25,
      opening: null,
      closing: null,
      comparison: 1000,
      accumulated: 1800,
      prior: 900,
      priorAccumulated: 1800,
    },
    {
      costCenterCode: null,
      costCenterName: null,
      sections: [section("costs", [account("5010", -50)])],
      total: -50,
      opening: null,
      closing: null,
      comparison: null,
      accumulated: null,
      prior: null,
      priorAccumulated: null,
    },
  ],
  total: 840.25,
  opening: null,
  closing: null,
  comparison: 1000,
  accumulated: 1800,
  prior: 900,
  priorAccumulated: 1800,
};

const balance: LedgerReport = {
  kind: "BALANCE",
  group: "SUMMED",
  groups: [
    {
      costCenterCode: null,
      costCenterName: null,
      sections: [
        section("assets", [account("1930", 500, { opening: 1000, closing: 1500, comparison: 1200 })], {
          total: 500,
          opening: 1000,
          closing: 1500,
          comparison: 1200,
        }),
      ],
      total: 500,
      opening: 1000,
      closing: 1500,
      comparison: 1200,
      accumulated: null,
      prior: null,
      priorAccumulated: null,
    },
  ],
  total: 500,
  opening: 1000,
  closing: 1500,
  comparison: 1200,
  accumulated: null,
  prior: null,
  priorAccumulated: null,
};

const ALL: ResultColumn[] = ["period", "prior", "accumulated", "priorAccumulated", "priorDiff"];

describe("reportToCsv", () => {
  it("writes a specified result report with every column and a comparison", () => {
    expect(
      reportToCsv(result, { specified: true, showComparison: true, comparisonLabel: "Budget", diff: true, columns: ALL, t }),
    ).toMatchSnapshot();
  });

  it("writes a summed result report with nothing picked (the period alone)", () => {
    expect(
      reportToCsv(result, { specified: false, showComparison: false, comparisonLabel: "", diff: false, columns: [], t }),
    ).toMatchSnapshot();
  });

  it("writes a comparison without the difference column", () => {
    expect(
      reportToCsv(result, {
        specified: false,
        showComparison: true,
        comparisonLabel: "Föregående år",
        diff: false,
        columns: ["priorDiff", "period"],
        t,
      }),
    ).toMatchSnapshot();
  });

  it("writes a balance report with its fixed columns, whatever columns are picked", () => {
    expect(
      reportToCsv(balance, { specified: false, showComparison: true, comparisonLabel: "Föregående år", diff: true, columns: ALL, t }),
    ).toMatchSnapshot();
  });
});
