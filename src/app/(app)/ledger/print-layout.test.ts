import { describe, expect, it } from "vitest";

import { printLines, type PrintLine } from "./print-layout";
import type { ReportAccount, ReportGroup } from "./report-types";

// SKT02's resultatrapport as Fortnox printed it: period and prior year.
const acc = (account: string, amount: number, comparison: number): ReportAccount => ({
  account,
  accountName: `Konto ${account}`,
  amount,
  opening: null,
  closing: null,
  comparison,
  accumulated: amount,
  prior: null,
  priorAccumulated: null,
});

const group = (accounts: ReportAccount[]): ReportGroup => ({
  costCenterCode: null,
  costCenterName: null,
  // One section on purpose: the print layout regroups by account number and
  // must not depend on how the screen's sections happened to split them.
  sections: [
    {
      key: "x",
      accounts,
      total: 0,
      opening: null,
      closing: null,
      comparison: null,
      accumulated: null,
      prior: null,
      priorAccumulated: null,
    },
  ],
  total: 0,
  opening: null,
  closing: null,
  comparison: null,
  accumulated: null,
  prior: null,
  priorAccumulated: null,
});

const skt02 = group([
  acc("3000", 0, 4188),
  acc("3740", -0.12, 0),
  acc("4000", -126.63, -1213.31),
  acc("5420", 0, -960),
  acc("5612", 0, -100),
  acc("6200", 0, -563),
  acc("6530", -35606, -36117),
  acc("6540", -948.6, -20743.02),
  acc("6570", -19711.11, -15199),
  acc("7331", 0, -455),
  acc("8422", -695.42, -1396.74),
]);

// Every line but the accounts, as "kind label period comparison", rounded to
// öre so float sums compare cleanly.
const outline = (lines: PrintLine[]) =>
  lines
    .filter((l) => l.kind !== "account")
    .map((l) =>
      "figures" in l
        ? `${l.kind} ${l.label} ${l.figures.amount.toFixed(2)} ${l.figures.comparison?.toFixed(2)}`
        : `${l.kind} ${l.label}`,
    );

describe("printLines", () => {
  it("lays a resultatrapport out as Fortnox does, with the same figures", () => {
    expect(outline(printLines(skt02, "RESULT"))).toEqual([
      "heading rorelsensIntakter",
      "part nettoomsattning",
      "partTotal nettoomsattning -0.12 4188.00",
      "total summaRorelsensIntakter -0.12 4188.00",
      "heading rorelsensKostnader",
      "part ravaror",
      "partTotal ravaror -126.63 -1213.31",
      "result bruttovinst -126.75 2974.69",
      "part externa",
      "partTotal externa -56265.71 -73682.02",
      "part personal",
      "partTotal personal 0.00 -455.00",
      "result rorelseresultat -56392.46 -71162.33",
      "part finansiella",
      "partTotal finansiella -695.42 -1396.74",
      "result resultatEfterFinansiella -57087.88 -72559.07",
      "total summaRorelsensKostnader -57087.76 -76747.07",
      "result beraknatResultat -57087.88 -72559.07",
    ]);
  });

  it("puts each account under its own class, in account order", () => {
    const accounts = printLines(skt02, "RESULT").flatMap((l) =>
      l.kind === "account" ? [l.account.account] : [],
    );
    expect(accounts).toEqual([
      "3000", "3740", "4000", "5420", "5612", "6200", "6530", "6540", "6570", "7331", "8422",
    ]);
  });

  it("prints Resultat före skatt only when there are bokslut or tax accounts", () => {
    const withTax = group([acc("3000", 100, 0), acc("8910", -20, 0)]);
    expect(outline(printLines(withTax, "RESULT"))).toContain(
      "result resultatForeSkatt 100.00 0.00",
    );
    expect(outline(printLines(skt02, "RESULT")).some((l) => l.includes("resultatForeSkatt"))).toBe(
      false,
    );
  });

  it("lays a balansrapport out by side, ending on the result", () => {
    const balance = group([
      { ...acc("1930", 50, 0), opening: 100, closing: 150 },
      { ...acc("2440", -30, 0), opening: -100, closing: -130 },
    ]);
    const lines = printLines(balance, "BALANCE");
    expect(outline(lines)).toEqual([
      "heading tillgangar",
      "part omsattning",
      "partTotal omsattning 50.00 0.00",
      "total summaTillgangar 50.00 0.00",
      "heading egetKapitalOchSkulder",
      "part kortfristiga",
      "partTotal kortfristiga -30.00 0.00",
      "total summaEgetKapitalOchSkulder -30.00 0.00",
      "result beraknatResultat 20.00 0.00",
    ]);
    const last = lines.at(-1)!;
    expect("figures" in last && last.figures.closing).toBe(20);
  });
});
