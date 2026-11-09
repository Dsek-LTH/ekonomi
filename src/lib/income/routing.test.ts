import { describe, expect, it } from "vitest";

import {
  routeSwishPayments,
  routeZettleSales,
  UNNAMED_PRODUCT,
  type RoutingTable,
} from "./routing";
import type { ZettleSaleLine } from "./types";

const table = (over: Partial<RoutingTable> = {}): RoutingTable => ({
  prefixes: new Map([
    ["c", { key: "cafe", account: "3000", costCenterId: "cc-cafe" }],
    ["s", { key: "sexet", account: "3010", costCenterId: "cc-sexet" }],
    ["s1", { key: "sexet", account: "3011", costCenterId: "cc-pub" }],
  ]),
  fallback: { key: "skatt", account: "3990", costCenterId: null },
  swishAmountGuesses: new Map([[1300, "c-Cola"]]),
  ...over,
});

const sale = (over: Partial<ZettleSaleLine> = {}): ZettleSaleLine => ({
  purchaseId: "p1",
  date: "2026-01-02",
  name: "c-Cola",
  quantity: 1,
  unitPrice: 1300,
  discount: 0,
  total: 1300,
  ...over,
});

const fee = { account: "6570", costCenterId: "cc-fee" };

/** The one day a test's sales came to. */
const oneDay = (sales: ZettleSaleLine[]) => {
  const days = routeZettleSales(table(), sales, [], fee);
  expect(days).toHaveLength(1);
  return days[0];
};

describe("routeZettleSales", () => {
  it("routes by prefix, strips it, and merges a day's identical lines", () => {
    const day = oneDay([sale(), sale({ purchaseId: "p2", quantity: 2, total: 2600 })]);

    expect(day).toMatchObject({ date: "2026-01-02", total: 3900 });
    expect(day.lines).toEqual([
      {
        kind: "SALE",
        unitKey: "cafe",
        name: "Cola",
        account: "3000",
        costCenterId: "cc-cafe",
        quantity: 3,
        unitPrice: 1300,
        effectiveDiscount: 0,
        total: 3900,
        unmatched: false,
      },
    ]);
  });

  it("sends a product with no known prefix to the reserv, marked unmatched", () => {
    const [line] = oneDay([sale({ name: "Biljett" })]).lines;
    expect(line).toMatchObject({
      unitKey: "skatt",
      name: "Biljett",
      account: "3990",
      costCenterId: null,
      unmatched: true,
    });
  });

  it("reads every separator intakt did", () => {
    const names = ["c-Cola", "c - Cola", "c \u2013 Cola", "c \u2014 Cola", "c Cola"];
    for (const name of names) {
      const [line] = oneDay([sale({ name })]).lines;
      expect(line.unitKey, name).toBe("cafe");
      expect(line.name, name).toBe("Cola");
    }
  });

  it("sends a product with no name to the reserv, named, rather than failing the fetch", () => {
    expect(oneDay([sale({ name: "" })]).lines[0]).toMatchObject({
      unitKey: "skatt",
      name: UNNAMED_PRODUCT,
      unmatched: true,
    });
  });

  // A prefix needs a separator after it: "cola" is not "c" + "ola".
  it("does not take the start of a word for a prefix", () => {
    expect(oneDay([sale({ name: "cola" })]).lines[0].unitKey).toBe("skatt");
  });

  // intakt matched only all-lower or all-upper.
  it("matches a prefix in any case", () => {
    const keys = oneDay([sale({ name: "C - Cola" }), sale({ name: "S1 - Öl" })]).lines.map(
      (l) => l.unitKey,
    );
    expect(keys).toEqual(["cafe", "sexet"]);
  });

  // "s1 - Öl" must not be read as "s" followed by "1 - Öl", whichever order
  // the prefixes happen to come in.
  it("prefers the longer of two overlapping prefixes, and takes its cost centre", () => {
    const [line] = oneDay([sale({ name: "s1 - Öl", unitPrice: 4000, total: 4000 })]).lines;
    expect(line).toMatchObject({ name: "Öl", account: "3011", costCenterId: "cc-pub" });
  });

  it("keeps the variant and the discount", () => {
    const [line] = oneDay([
      sale({ name: "c-Kaffe", variant: "Stor", unitPrice: 2000, discount: 500, total: 1500 }),
    ]).lines;
    expect(line).toMatchObject({ variant: "Stor", effectiveDiscount: 500, total: 1500 });
  });

  it("is one report per day, every verksamhet on it, oldest day first", () => {
    const days = routeZettleSales(
      table(),
      [sale({ date: "2026-01-03" }), sale({ name: "s1 - Öl" }), sale()],
      [],
      fee,
    );
    expect(days.map((d) => d.date)).toEqual(["2026-01-02", "2026-01-03"]);
    expect(days[0].lines.map((l) => l.unitKey)).toEqual(["sexet", "cafe"]);
  });

  // The same product sold under two cost centres must stay two lines, or the
  // voucher could not book them apart.
  it("does not merge lines that book to different cost centres", () => {
    const pub = table({
      prefixes: new Map([
        ["c", { key: "cafe", account: "3000", costCenterId: "cc-cafe" }],
        ["k", { key: "cafe", account: "3000", costCenterId: "cc-event" }],
      ]),
    });
    const [day] = routeZettleSales(
      pub,
      [sale({ name: "c-Cola" }), sale({ name: "k-Cola" })],
      [],
      fee,
    );
    expect(day.lines.map((l) => l.costCenterId)).toEqual(["cc-cafe", "cc-event"]);
  });

  it("puts the day's fees on the same day, as negative lines on the fee account", () => {
    const days = routeZettleSales(
      table(),
      [sale()],
      [
        { date: "2026-01-02", amount: 150 },
        { date: "2026-01-02", amount: 150 },
        { date: "2026-01-02", amount: 0 },
        { date: "2026-01-02", amount: -40 },
      ],
      fee,
    );
    expect(days).toHaveLength(1);
    const fees = days[0].lines.filter((l) => l.kind === "FEE");
    expect(fees).toEqual([
      expect.objectContaining({
        account: "6570",
        costCenterId: "cc-fee",
        unitKey: null,
        quantity: 2,
        unitPrice: -150,
        total: -300,
      }),
      // A fee Zettle paid back adds to what the day pays out.
      expect.objectContaining({ quantity: 1, unitPrice: 40, total: 40 }),
    ]);
    // Net of fees: what the clearing account moves by.
    expect(days[0].total).toBe(1300 - 300 + 40);
  });

  it("makes a day of fees alone when nothing was sold", () => {
    const days = routeZettleSales(table(), [], [{ date: "2026-01-04", amount: 90 }], fee);
    expect(days).toEqual([
      expect.objectContaining({ date: "2026-01-04", total: -90 }),
    ]);
  });
});

describe("routeSwishPayments", () => {
  it("routes by the message, then by the amount guess, then to the reserv", () => {
    const [day] = routeSwishPayments(table(), [
      { date: "2026-01-02", message: "c - Bulle", amount: 2500 },
      { date: "2026-01-02", message: "", amount: 1300 },
      { date: "2026-01-02", message: "Tack för igår", amount: 5000 },
    ]);

    expect(day.total).toBe(8800);
    expect(day.lines.filter((l) => l.unitKey === "cafe").map((l) => l.name)).toEqual([
      "Bulle",
      "Cola",
    ]);
    expect(day.lines.find((l) => l.unitKey === "skatt")).toMatchObject({
      name: "Tack för igår",
      account: "3990",
      total: 5000,
      unmatched: true,
    });
  });
});
