import { describe, expect, it } from "vitest";

import {
  allocateByLargestRemainder,
  normalizeFees,
  normalizePurchases,
  purchaseDiscountValue,
  stockholmMidnight,
  TX_PAYMENT,
  TX_PAYMENT_FEE,
  TX_PAYOUT,
  zettleDay,
  zettleRange,
} from "./zettle";

describe("zettleDay", () => {
  it.each([
    ["2025-01-15T10:30:00Z", "2025-01-15"],
    ["2025-01-15T10:30:00.123456789Z", "2025-01-15"],
    ["2025-01-15T10:30:00.000+0000", "2025-01-15"],
    ["2025-01-15T10:30:00+0000", "2025-01-15"],
    ["2025-01-15", "2025-01-15"],
  ])("reads Zettle's layout %s", (ts, day) => {
    expect(zettleDay(ts)).toBe(day);
  });

  it.each([
    // 23:30 UTC in winter (CET) is 00:30 the next day in Sweden.
    ["2025-01-15T23:30:00.000+0000", "2025-01-16"],
    // 22:30 UTC in summer (CEST) is 00:30 the next day in Sweden.
    ["2025-09-10T22:30:00.000+0000", "2025-09-11"],
    // 21:30 UTC in summer is still 23:30 the same day.
    ["2025-09-10T21:30:00.000+0000", "2025-09-10"],
    // A timestamp carrying a local offset keeps its local date.
    ["2025-09-11T00:30:00+0200", "2025-09-11"],
    ["2026-01-02T00:30:00.000+0100", "2026-01-02"],
    // The finance API leaves the offset off, and that is read as UTC.
    ["2026-07-01T22:30:00.000", "2026-07-02"],
    ["2026-07-01T21:30:00", "2026-07-01"],
  ])("puts %s on the Swedish day %s", (ts, day) => {
    expect(zettleDay(ts)).toBe(day);
  });

  it("passes an unreadable timestamp through, so it stands out", () => {
    expect(zettleDay("not a timestamp")).toBe("not a timestamp");
  });

  // Every minute of a Swedish day, winter and summer, lands on that day.
  it("groups every minute of a day into it", () => {
    for (const [day, offset] of [
      ["2026-01-15", 1],
      ["2026-07-15", 2],
    ] as const) {
      const start = Date.parse(`${day}T00:00:00Z`) - offset * 3_600_000;
      for (let m = 0; m < 24 * 60; m += 7) {
        const iso = new Date(start + m * 60_000).toISOString();
        expect(zettleDay(iso), iso).toBe(day);
      }
    }
  });
});

describe("zettleRange", () => {
  it("starts at Swedish midnight and ends at the next day's, Zettle's end being exclusive", () => {
    expect(zettleRange("2026-01-01", "2026-01-31")).toEqual({
      start: "2026-01-01T00:00:00+01:00",
      end: "2026-02-01T00:00:00+01:00",
    });
  });

  it("uses summer time in summer, and gets the days the clocks change right", () => {
    expect(stockholmMidnight("2026-07-01")).toBe("2026-07-01T00:00:00+02:00");
    // Clocks go forward at 02:00 on 29 March 2026, so that midnight is still winter.
    expect(stockholmMidnight("2026-03-29")).toBe("2026-03-29T00:00:00+01:00");
    expect(stockholmMidnight("2026-03-30")).toBe("2026-03-30T00:00:00+02:00");
    // And back at 03:00 on 25 October.
    expect(stockholmMidnight("2026-10-25")).toBe("2026-10-25T00:00:00+02:00");
    expect(stockholmMidnight("2026-10-26")).toBe("2026-10-26T00:00:00+01:00");
  });

  it("crosses a month and a year", () => {
    expect(zettleRange("2026-12-31", "2026-12-31").end).toBe("2027-01-01T00:00:00+01:00");
  });
});

describe("normalizePurchases", () => {
  it("spreads a purchase-level discount over the lines, to the öre", () => {
    const lines = normalizePurchases([
      {
        purchaseUUID: "p1",
        timestamp: "2026-01-02T10:00:00.000+0100",
        products: [
          { name: "c-Cola", quantity: "1", unitPrice: 1000 },
          { name: "c-Bulle", quantity: "2", unitPrice: 1000 },
        ],
        discounts: [{ amount: 100 }],
      },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0].discount + lines[1].discount).toBe(100);
    expect(lines[0].total + lines[1].total).toBe(2900);
    expect(lines[1].discount).toBe(67);
  });

  it("keeps the name as rung up, the variant, the line's own discount and the day", () => {
    const [line] = normalizePurchases([
      {
        purchaseUUID: "p2",
        timestamp: "2026-07-01T22:30:00.000+0000",
        products: [
          {
            name: "c-Kaffe",
            variantName: "Stor",
            quantity: "3",
            unitPrice: 2000,
            discountValue: 500,
          },
        ],
      },
    ]);
    expect(line).toEqual({
      purchaseId: "p2",
      date: "2026-07-02",
      name: "c-Kaffe",
      variant: "Stor",
      quantity: 3,
      unitPrice: 2000,
      discount: 500,
      total: 5500,
    });
  });

  it("reads a refund's negative quantity, and gives it no share of a discount", () => {
    const lines = normalizePurchases([
      {
        purchaseUUID: "r1",
        timestamp: "2026-01-02T10:00:00Z",
        products: [
          { name: "c-Cola", quantity: "-1", unitPrice: 1000 },
          { name: "c-Bulle", quantity: "1", unitPrice: 1000 },
        ],
        discounts: [{ amount: 100 }],
      },
    ]);
    expect(lines.map((l) => l.total)).toEqual([-1000, 900]);
  });

  it("reads a field Zettle left out as Go's zero value", () => {
    const [line] = normalizePurchases([
      {
        purchaseUUID: "c1",
        timestamp: "2026-11-01T12:00:00Z",
        products: [{ quantity: "1", unitPrice: 5000 }],
      },
    ]);
    expect(line).toMatchObject({
      name: "",
      quantity: 1,
      unitPrice: 5000,
      discount: 0,
      total: 5000,
    });
    expect(line).not.toHaveProperty("variant");
    expect(normalizePurchases([{ purchaseUUID: "c2", timestamp: "2026-11-01T12:00:00Z" }])).toEqual(
      [],
    );
  });

  it("leaves a purchase with nothing positive undiscounted", () => {
    const [line] = normalizePurchases([
      {
        purchaseUUID: "r2",
        timestamp: "2026-01-02T10:00:00Z",
        products: [{ name: "c-Cola", quantity: "-1", unitPrice: 1000 }],
        discounts: [{ amount: 100 }],
      },
    ]);
    expect(line.total).toBe(-1000);
  });
});

describe("purchaseDiscountValue", () => {
  it.each([
    ["value wins", { value: 500, amount: 250 }, 1000, 500],
    ["amount", { amount: 250 }, 1000, 250],
    ["percentage rounds half up", { percentage: 10 }, 1015, 102],
    ["empty", {}, 1000, 0],
  ])("%s", (_name, discount, total, want) => {
    expect(purchaseDiscountValue(discount, total)).toBe(want);
  });
});

describe("allocateByLargestRemainder", () => {
  it("is exact, the extra öre on the earliest of equal remainders", () => {
    expect(allocateByLargestRemainder(10, [3, 3, 3], 9)).toEqual([4, 3, 3]);
  });

  it("gives nothing to a line that is not positive", () => {
    const got = allocateByLargestRemainder(100, [500, -200, 500], 1000);
    expect(got[1]).toBe(0);
    expect(got[0] + got[2]).toBe(100);
  });
});

describe("normalizeFees", () => {
  it("keeps only the fees, as positive costs on their Swedish day", () => {
    expect(
      normalizeFees([
        {
          timestamp: "2026-01-02T10:00:00.000+0100",
          amount: 5000,
          originatorTransactionType: TX_PAYMENT,
        },
        {
          timestamp: "2026-01-02T10:00:00.000+0100",
          amount: -150,
          originatorTransactionType: TX_PAYMENT_FEE,
        },
        {
          timestamp: "2026-01-02T10:00:00.000+0100",
          amount: 0,
          originatorTransactionType: TX_PAYMENT_FEE,
        },
        {
          timestamp: "2026-01-03T08:00:00.000+0100",
          amount: -4850,
          originatorTransactionType: TX_PAYOUT,
        },
      ]),
    ).toEqual([{ date: "2026-01-02", amount: 150 }]);
  });

  it("keeps a fee paid back, as a negative cost", () => {
    expect(
      normalizeFees([
        { timestamp: "2026-01-02T10:00:00", amount: 40, originatorTransactionType: TX_PAYMENT_FEE },
      ]),
    ).toEqual([{ date: "2026-01-02", amount: -40 }]);
  });
});
