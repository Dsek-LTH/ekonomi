import { describe, expect, it } from "vitest";

import { voucherBlocker } from "@/lib/domain/voucher";
import {
  buildFeeVoucherLines,
  buildIncomeVoucherLines,
  incomeVoucherBlocker,
  incomeVoucherDescription,
  incomeVoucherKey,
  incomeVoucherSeries,
  type IncomeVoucherInput,
} from "./voucher";
import type { IncomeAccountDistribution } from "./types";

const names: Record<string, string> = {
  "3000": "Försäljning inom Sverige",
  "3011": "Öl",
  "1931": "Swishkonto",
  "1930": "Företagskonto",
  "6570": "Bankkostnader",
};

const input = (
  distributions: IncomeAccountDistribution[],
  overrides: Partial<IncomeVoucherInput> = {},
): IncomeVoucherInput => ({
  distributions,
  total: distributions.reduce((s, d) => s + d.total, 0),
  clearingAccount: "1931",
  clearingAccountName: "Swishkonto",
  costCenterId: "cc-cafe",
  accountName: (a) => names[a] ?? "",
  ...overrides,
});

const dist = (account: string, total: number): IncomeAccountDistribution => ({
  account,
  description: names[account] ?? "",
  total,
});

describe("incomeVoucherBlocker", () => {
  it("passes a report whose distributions add up to its total", () => {
    expect(incomeVoucherBlocker(input([dist("3000", 17500)]))).toBeNull();
  });

  it("refuses a report with nothing to book", () => {
    expect(incomeVoucherBlocker(input([]))).toBe("noDistributions");
    // All-zero is the same thing: there is no voucher to write.
    expect(incomeVoucherBlocker(input([dist("3000", 0)]))).toBe("noDistributions");
  });

  it("refuses one whose distributions disagree with its total", () => {
    // The case this exists for. Both numbers come from the service, computed
    // separately; if they ever part company the voucher would be rejected by
    // Fortnox at export rather than here.
    expect(incomeVoucherBlocker(input([dist("3000", 17500)], { total: 17400 }))).toBe("unbalanced");
  });

  it("refuses one with no cost centre chosen", () => {
    expect(incomeVoucherBlocker(input([dist("3000", 17500)], { costCenterId: null }))).toBe(
      "noCostCenter",
    );
  });

  it("refuses one with no clearing account configured", () => {
    expect(incomeVoucherBlocker(input([dist("3000", 17500)], { clearingAccount: "  " }))).toBe(
      "noClearingAccount",
    );
  });
});

describe("buildIncomeVoucherLines", () => {
  it("credits each revenue account and debits the clearing account", () => {
    const lines = buildIncomeVoucherLines(input([dist("3011", 5000), dist("3000", 17500)]));

    expect(lines).toHaveLength(3);
    // Sorted by account, so the same shape of day always reads the same.
    expect(lines.map((l) => l.account)).toEqual(["3000", "3011", "1931"]);

    expect(lines[0]).toMatchObject({ credit: 17500, debit: 0, costCenterId: "cc-cafe" });
    expect(lines[1]).toMatchObject({ credit: 5000, debit: 0, costCenterId: "cc-cafe" });
    expect(lines[2]).toMatchObject({ account: "1931", debit: 22500, credit: 0 });
  });

  it("balances, by the same rule the expense booking screen is held to", () => {
    const lines = buildIncomeVoucherLines(input([dist("3011", 5000), dist("3000", 17500)]));
    // Not a re-implementation of the check. The actual shared one.
    expect(voucherBlocker(lines)).toBeNull();
  });

  it("leaves the clearing row without a cost centre", () => {
    // A clearing account is a bank balance, not a dimension of a budget. A cost
    // centre here would make the committee's outcome count the takings twice.
    const lines = buildIncomeVoucherLines(input([dist("3000", 17500)]));
    expect(lines.at(-1)?.costCenterId).toBeNull();
  });

  it("drops zero-valued distributions", () => {
    // A product sold and fully refunded the same day nets to zero against its
    // account. A row for nothing is noise, and Fortnox rejects some outright.
    const lines = buildIncomeVoucherLines(input([dist("3000", 17500), dist("3011", 0)]));
    expect(lines.map((l) => l.account)).toEqual(["3000", "1931"]);
    expect(voucherBlocker(lines)).toBeNull();
  });

  it("books a net refund as a debit rather than a negative credit", () => {
    // More refunded than sold against 3011 on the day. A ledger has no negative
    // credit; it has a debit.
    const lines = buildIncomeVoucherLines(input([dist("3000", 17500), dist("3011", -2500)]));

    const beer = lines.find((l) => l.account === "3011");
    expect(beer).toMatchObject({ debit: 2500, credit: 0 });
    expect(lines.every((l) => l.debit >= 0 && l.credit >= 0)).toBe(true);

    // 17500 credited, 2500 debited. The bank gained 15000.
    expect(lines.at(-1)).toMatchObject({ account: "1931", debit: 15000, credit: 0 });
    expect(voucherBlocker(lines)).toBeNull();
  });

  it("books a wholly negative day the other way round and still balances", () => {
    // A day of nothing but refunds: money left the clearing account.
    const lines = buildIncomeVoucherLines(input([dist("3000", -4000)]));

    expect(lines[0]).toMatchObject({ account: "3000", debit: 4000, credit: 0 });
    expect(lines.at(-1)).toMatchObject({ account: "1931", debit: 0, credit: 4000 });
    expect(voucherBlocker(lines)).toBeNull();
  });

  it("carries the account name at booking time", () => {
    // Denormalised for the same reason VerificationLine.accountName is: the
    // chart of accounts may change, a booked document may not.
    const lines = buildIncomeVoucherLines(input([dist("3011", 5000)]));
    expect(lines[0].accountName).toBe("Öl");
    expect(lines.at(-1)?.accountName).toBe("Swishkonto");
  });
});

describe("buildFeeVoucherLines", () => {
  it("debits the fee account and credits the clearing account", () => {
    // Fees are a cost, so they run the opposite way to takings.
    const lines = buildFeeVoucherLines({
      report: { key: "avgift-2026-01-02", date: "2026-01-02", total: 4200, fees: [] },
      feeAccount: "6570",
      feeAccountName: "Bankkostnader",
      clearingAccount: "1930",
      clearingAccountName: "Företagskonto",
      costCenterId: "cc-skatt",
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ account: "6570", debit: 4200, credit: 0, costCenterId: "cc-skatt" });
    expect(lines[1]).toMatchObject({ account: "1930", debit: 0, credit: 4200, costCenterId: null });
    expect(voucherBlocker(lines)).toBeNull();
  });
});

describe("incomeVoucherDescription", () => {
  it("names the payment method and the committee, and no series", () => {
    // No "IR ": every one of these is filed in the income series already, so
    // the prefix spent characters saying what the series says. The key below is
    // what keeps the ones written the old way recognisable.
    expect(incomeVoucherDescription("SWISH", "Café")).toBe("Swish - Café");
    expect(incomeVoucherDescription("ZETTLE", "Café")).toBe("Zettle - Café");
  });

  it("is the same text for every day of fees", () => {
    // Fees belong to no committee, so the date is the only thing telling two
    // days of them apart, which the key below is what expresses.
    expect(incomeVoucherDescription("ZETTLE_FEE", null)).toBe("Zettleavgifter");
    expect(incomeVoucherDescription("ZETTLE_FEE", "Café")).toBe("Zettleavgifter");
  });

  it("leaves no trailing separator for a committee with no description", () => {
    expect(incomeVoucherDescription("SWISH", null)).toBe("Swish -");
  });
});

describe("incomeVoucherKey", () => {
  it("recognises the same day written differently", () => {
    // What the duplicate check compares. A voucher already in Fortnox was
    // written by whatever wrote it (an older install, the CLI this replaced),
    // so the match cannot depend on spacing or case.
    expect(incomeVoucherKey("2026-01-02", "Swish - Café")).toBe(
      incomeVoucherKey("2026-01-02", "  swish -  café "),
    );
  });

  it("matches a day booked under the old IR prefix against one without it", () => {
    // The fail-safe the prefix removal turns on. Fortnox holds vouchers written
    // both ways, and a report booked before the change still carries the old
    // text locally, which is what the export re-checks with. Every pairing has
    // to land on the same key or a day gets booked twice.
    const plain = incomeVoucherKey("2026-01-02", "Swish - Café");
    expect(incomeVoucherKey("2026-01-02", "IR Swish - Café")).toBe(plain);
    expect(incomeVoucherKey("2026-01-02", "ir  swish - café")).toBe(plain);
    expect(incomeVoucherKey("2026-01-02", "IR Zettle - Café")).toBe(
      incomeVoucherKey("2026-01-02", "Zettle - Café"),
    );
  });

  it("only strips IR where it is the prefix, not where it starts a name", () => {
    // "IR" is two letters a verksamhet may well begin with. Stripping it
    // anywhere but the front would collapse two different days into one.
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
    // What every income voucher was written to before the setting existed, and
    // what an install that upgrades and sets nothing keeps doing.
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
