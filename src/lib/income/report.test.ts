import { describe, expect, it } from "vitest";

import { distributionsFor, toFeeReportDto, toReportDto, type StoredLine } from "./report";

const line = (over: Partial<StoredLine> = {}): StoredLine => ({
  name: "Cola",
  variant: null,
  account: "3000",
  accountName: "Försäljning inom Sverige",
  quantity: 1,
  unitPrice: 1300,
  discount: 0,
  total: 1300,
  ...over,
});

describe("distributionsFor", () => {
  it("sums lines sharing an account", () => {
    const got = distributionsFor([line(), line(), line({ account: "3011", accountName: "Öl", total: 5000 })]);

    expect(got).toEqual([
      { account: "3000", description: "Försäljning inom Sverige", total: 2600 },
      { account: "3011", description: "Öl", total: 5000 },
    ]);
  });

  it("orders by account, whatever order the till rang things up in", () => {
    // Stable output is what makes the same day produce the same voucher rows
    // and the same PDF twice running.
    const got = distributionsFor([
      line({ account: "3015", accountName: "Biljetter" }),
      line({ account: "3000" }),
      line({ account: "3011", accountName: "Öl" }),
    ]);
    expect(got.map((d) => d.account)).toEqual(["3000", "3011", "3015"]);
  });

  it("keeps a net-negative account rather than dropping it", () => {
    // More refunded than sold against an account. It still has to reach the
    // voucher (as a debit row) or the voucher would not balance.
    const got = distributionsFor([line({ total: 1300 }), line({ total: -2000 })]);
    expect(got).toEqual([{ account: "3000", description: "Försäljning inom Sverige", total: -700 }]);
  });

  it("sums to the same total as the lines", () => {
    const lines = [line({ total: 1300 }), line({ account: "3011", accountName: "Öl", total: 5000 })];
    const distributed = distributionsFor(lines).reduce((s, d) => s + d.total, 0);
    expect(distributed).toBe(lines.reduce((s, l) => s + l.total, 0));
  });
});

describe("toReportDto", () => {
  const stored = {
    date: new Date("2026-01-02T00:00:00.000Z"),
    total: 2600,
    resultUnit: { income: { key: "cafe" } },
    lines: [line({ total: 2600, quantity: 2 })],
  };

  it("rebuilds the key the service files a report under", () => {
    expect(toReportDto(stored).key).toBe("cafe-2026-01-02");
  });

  it("maps discount to the service's effectiveDiscount", () => {
    const dto = toReportDto({ ...stored, lines: [line({ discount: 500, total: 800 })] });
    expect(dto.products[0]).toMatchObject({ effectiveDiscount: 500, total: 800 });
  });

  it("omits variant entirely rather than sending null", () => {
    // The Go field is `variant,omitempty`; a null would render as an empty
    // column in the PDF's item table rather than as no sub-row at all.
    const dto = toReportDto(stored);
    expect("variant" in dto.products[0]).toBe(false);

    const withVariant = toReportDto({ ...stored, lines: [line({ variant: "Stor" })] });
    expect(withVariant.products[0].variant).toBe("Stor");
  });

  it("recomputes distributions from the lines", () => {
    const dto = toReportDto(stored);
    expect(dto.accountDistributions).toEqual([
      { account: "3000", description: "Försäljning inom Sverige", total: 2600 },
    ]);
  });
});

describe("toFeeReportDto", () => {
  it("uses the avgift key and carries the fee lines", () => {
    const dto = toFeeReportDto({
      date: new Date("2026-01-02T00:00:00.000Z"),
      total: 4200,
      resultUnit: null,
      lines: [line({ name: "Zettle fee", account: "6570", accountName: "Bankkostnader", quantity: 7, unitPrice: 600, total: 4200 })],
    });

    expect(dto.key).toBe("avgift-2026-01-02");
    expect(dto.date).toBe("2026-01-02");
    expect(dto.fees).toEqual([
      { name: "Zettle fee", account: "6570", quantity: 7, unitPrice: 600, total: 4200 },
    ]);
  });
});
