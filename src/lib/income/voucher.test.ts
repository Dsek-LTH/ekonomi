import { describe, expect, it } from "vitest";

import { voucherBlocker } from "@/lib/domain/voucher";
import {
  buildDayVoucherLines,
  incomeVoucherBlocker,
  incomeVoucherCoversDay,
  incomeVoucherDescription,
  incomeVoucherKey,
  incomeVoucherSeries,
  type DayVoucherInput,
  type DayVoucherInputLine,
} from "./voucher";

const names: Record<string, string> = {
  "3000": "Försäljning inom Sverige",
  "3011": "Öl",
  "1580": "Zettle-fordran",
  "6570": "Bankkostnader",
};

const line = (
  account: string,
  costCenterId: string | null,
  total: number,
): DayVoucherInputLine => ({
  account,
  costCenterId,
  total,
});

const input = (
  lines: DayVoucherInputLine[],
  overrides: Partial<DayVoucherInput> = {},
): DayVoucherInput => ({
  lines,
  total: lines.reduce((s, l) => s + l.total, 0),
  clearingAccount: "1580",
  accountName: (a) => names[a] ?? "",
  ...overrides,
});

describe("incomeVoucherBlocker", () => {
  it("passes a day whose lines add up to its total", () => {
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 17500)]))).toBeNull();
  });

  it("refuses a day with nothing to book", () => {
    expect(incomeVoucherBlocker(input([]))).toBe("noDistributions");
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 0)]))).toBe("noDistributions");
  });

  it("refuses a line with no cost centre, revenue or fee alike", () => {
    expect(incomeVoucherBlocker(input([line("3000", null, 100)]))).toBe("noCostCenter");
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 1000), line("6570", null, -30)]))).toBe(
      "noCostCenter",
    );
  });

  it("does not hold a zero line's missing cost centre against the day", () => {
    expect(
      incomeVoucherBlocker(input([line("3000", "cafe", 100), line("3011", null, 0)])),
    ).toBeNull();
  });

  it("refuses a fee line with no fee account chosen", () => {
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 1000), line("", "fee", -30)]))).toBe(
      "noAccount",
    );
  });

  it("refuses a day whose stored total has drifted from its lines", () => {
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 17500)], { total: 17400 }))).toBe(
      "unbalanced",
    );
  });

  it("refuses one with no clearing account configured", () => {
    expect(incomeVoucherBlocker(input([line("3000", "cafe", 100)], { clearingAccount: " " }))).toBe(
      "noClearingAccount",
    );
  });
});

describe("buildDayVoucherLines", () => {
  it("is one row per account and cost centre, then the clearing account", () => {
    const rows = buildDayVoucherLines(
      input([
        line("3000", "cafe", 1000),
        line("3011", "pub", 4000),
        line("3000", "cafe", 500),
        line("3000", "sexet", 300),
      ]),
    );
    expect(rows.map((r) => [r.account, r.costCenterId, r.debit, r.credit])).toEqual([
      ["3000", "cafe", 0, 1500],
      ["3000", "sexet", 0, 300],
      ["3011", "pub", 0, 4000],
      ["1580", null, 5800, 0],
    ]);
    expect(voucherBlocker(rows)).toBeNull();
  });

  it("debits the fee account and pays out the net", () => {
    const rows = buildDayVoucherLines(
      input([line("3000", "cafe", 10000), line("6570", "fee", -175)]),
    );
    expect(rows.map((r) => [r.account, r.debit, r.credit])).toEqual([
      ["3000", 0, 10000],
      ["6570", 175, 0],
      ["1580", 9825, 0],
    ]);
    expect(voucherBlocker(rows)).toBeNull();
  });

  it("books a net refund against an account as a debit, not a negative credit", () => {
    const rows = buildDayVoucherLines(
      input([line("3000", "cafe", 15000), line("3011", "pub", -5000)]),
    );
    expect(rows.find((r) => r.account === "3011")).toMatchObject({ debit: 5000, credit: 0 });
    expect(rows.at(-1)).toMatchObject({ account: "1580", debit: 10000, credit: 0 });
    expect(voucherBlocker(rows)).toBeNull();
  });

  it("credits the clearing account on a day that came to a net refund", () => {
    const rows = buildDayVoucherLines(input([line("3000", "cafe", -2000)]));
    expect(rows.at(-1)).toMatchObject({ account: "1580", debit: 0, credit: 2000 });
    expect(voucherBlocker(rows)).toBeNull();
  });

  it("leaves the clearing row without a cost centre", () => {
    const rows = buildDayVoucherLines(input([line("3000", "cafe", 100)]));
    expect(rows.at(-1)?.costCenterId).toBeNull();
  });

  it("drops rows that came to nothing, and the clearing row on a day that nets to zero", () => {
    expect(
      buildDayVoucherLines(input([line("3000", "cafe", 100), line("3000", "cafe", -100)])),
    ).toEqual([]);
    const rows = buildDayVoucherLines(
      input([line("3000", "cafe", 500), line("3011", "pub", -500)]),
    );
    expect(rows.map((r) => r.account)).toEqual(["3000", "3011"]);
    expect(voucherBlocker(rows)).toBeNull();
  });

  it("carries the account name at booking time", () => {
    const [row] = buildDayVoucherLines(input([line("3011", "pub", 100)]));
    expect(row.accountName).toBe("Öl");
  });
});

describe("incomeVoucherDescription", () => {
  it("is the payment method, since the voucher is the whole day", () => {
    expect(incomeVoucherDescription("SWISH")).toBe("Swish");
    expect(incomeVoucherDescription("ZETTLE")).toBe("Zettle");
  });
});

describe("incomeVoucherCoversDay", () => {
  // Every wording ever written to Fortnox for some of a day's Zettle money.
  it("recognises every generation of Zettle voucher", () => {
    for (const text of ["Zettle", "Zettle - Café", "Zettleavgifter", "IR Zettle - Pub"]) {
      expect(incomeVoucherCoversDay("ZETTLE", text), text).toBe(true);
      expect(incomeVoucherCoversDay("SWISH", text), text).toBe(false);
    }
  });

  it("recognises Swish ones, and not a word that merely starts the same", () => {
    expect(incomeVoucherCoversDay("SWISH", "Swish")).toBe(true);
    expect(incomeVoucherCoversDay("SWISH", "IR Swish - Café")).toBe(true);
    expect(incomeVoucherCoversDay("SWISH", "Swishkonto avgift")).toBe(false);
    expect(incomeVoucherCoversDay("ZETTLE", "Inköp kaffe")).toBe(false);
  });
});

describe("incomeVoucherKey", () => {
  it("recognises the same day written differently", () => {
    expect(incomeVoucherKey("2026-01-02", "Swish - Café")).toBe(
      incomeVoucherKey("2026-01-02", "  swish -  café "),
    );
  });

  it("matches a day booked under the old IR prefix against one without it", () => {
    const plain = incomeVoucherKey("2026-01-02", "Swish - Café");
    expect(incomeVoucherKey("2026-01-02", "IR Swish - Café")).toBe(plain);
    expect(incomeVoucherKey("2026-01-02", "ir  swish - café")).toBe(plain);
    expect(incomeVoucherKey("2026-01-02", "IR Zettle - Café")).toBe(
      incomeVoucherKey("2026-01-02", "Zettle - Café"),
    );
  });

  it("only strips IR where it is the prefix, not where it starts a name", () => {
    expect(incomeVoucherKey("2026-01-02", "Swish - Irrblosset")).not.toBe(
      incomeVoucherKey("2026-01-02", "Swish - rblosset"),
    );
    expect(incomeVoucherKey("2026-01-02", "Irrblosset")).not.toBe(
      incomeVoucherKey("2026-01-02", "rblosset"),
    );
  });

  it("keeps different days and different committees apart", () => {
    const a = incomeVoucherKey("2026-01-02", "Swish - Café");
    expect(a).not.toBe(incomeVoucherKey("2026-01-03", "Swish - Café"));
    expect(a).not.toBe(incomeVoucherKey("2026-01-02", "Swish - Pub"));
    // The source is part of the text, so Zettle and Swish for one day are two.
    expect(a).not.toBe(incomeVoucherKey("2026-01-02", "Zettle - Café"));
  });
});

describe("incomeVoucherSeries", () => {
  it("is the connection's series when income has no opinion", () => {
    expect(incomeVoucherSeries(null, "A")).toBe("A");
    expect(incomeVoucherSeries({ incomeVoucherSeries: null }, "A")).toBe("A");
  });

  it("is income's own once it has one", () => {
    expect(incomeVoucherSeries({ incomeVoucherSeries: "I" }, "A")).toBe("I");
  });

  it("treats blank as unset rather than as a series called nothing", () => {
    // A row left as "" would otherwise export to a series Fortnox does not have.
    expect(incomeVoucherSeries({ incomeVoucherSeries: "   " }, "A")).toBe("A");
  });
});
