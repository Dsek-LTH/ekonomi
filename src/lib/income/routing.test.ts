import { describe, expect, it } from "vitest";

import { groupZettleFees, routeSwishPayments, routeZettleSales, type RoutingTable } from "./routing";
import type { ZettleSaleLine } from "./types";

const table = (over: Partial<RoutingTable> = {}): RoutingTable => ({
  prefixes: new Map([
    ["c", { key: "cafe", account: "3000" }],
    ["s", { key: "sexet", account: "3010" }],
    ["s1", { key: "sexet", account: "3011" }],
  ]),
  fallback: { key: "skatt", account: "3990" },
  swishAmountGuesses: new Map([[1300, "c-Cola"]]),
  accountNames: new Map([
    ["3000", "Försäljning inom Sverige"],
    ["3011", "Öl"],
  ]),
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

describe("routeZettleSales", () => {
  it("routes by prefix, strips it, and merges a day's identical lines", () => {
    const got = routeZettleSales(table(), [sale(), sale({ purchaseId: "p2", quantity: 2, total: 2600 })]);

    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ key: "cafe-2026-01-02", committee: "cafe", total: 3900 });
    expect(got[0].products).toEqual([
      { name: "Cola", account: "3000", quantity: 3, unitPrice: 1300, effectiveDiscount: 0, total: 3900 },
    ]);
    expect(got[0].accountDistributions).toEqual([
      { account: "3000", description: "Försäljning inom Sverige", total: 3900 },
    ]);
  });

  it("sends a product with no known prefix to the reserv under its full name", () => {
    const [report] = routeZettleSales(table(), [sale({ name: "Biljett" })]);

    expect(report.committee).toBe("skatt");
    expect(report.products[0]).toMatchObject({ name: "Biljett", account: "3990" });
  });

  it("reads every separator intakt did", () => {
    const names = ["c-Cola", "c - Cola", "c \u2013 Cola", "c \u2014 Cola", "c Cola"];
    for (const name of names) {
      const [report] = routeZettleSales(table(), [sale({ name })]);
      expect(report.committee, name).toBe("cafe");
      expect(report.products[0].name, name).toBe("Cola");
    }
  });

  // A prefix needs a separator after it: "cola" is not "c" + "ola".
  it("does not take the start of a word for a prefix", () => {
    const [report] = routeZettleSales(table(), [sale({ name: "cola" })]);
    expect(report.committee).toBe("skatt");
  });

  // intakt matched only all-lower or all-upper.
  it("matches a prefix in any case", () => {
    const [report] = routeZettleSales(table(), [sale({ name: "C - Cola" }), sale({ name: "S1 - Öl" })]);
    expect(report.committee).toBe("cafe");
  });

  // "s1 - Öl" must not be read as "s" followed by "1 - Öl", whichever order
  // the prefixes happen to come in.
  it("prefers the longer of two overlapping prefixes", () => {
    const [report] = routeZettleSales(table(), [sale({ name: "s1 - Öl", unitPrice: 4000, total: 4000 })]);
    expect(report.products[0]).toMatchObject({ name: "Öl", account: "3011" });
  });

  it("keeps the variant and the discount", () => {
    const [report] = routeZettleSales(table(), [
      sale({ name: "c-Kaffe", variant: "Stor", unitPrice: 2000, discount: 500, total: 1500 }),
    ]);
    expect(report.products[0]).toMatchObject({ variant: "Stor", effectiveDiscount: 500, total: 1500 });
  });

  it("is one report per verksamhet and day, sorted by key", () => {
    const got = routeZettleSales(table(), [
      sale({ date: "2026-01-03" }),
      sale({ name: "s1 - Öl" }),
      sale(),
    ]);
    expect(got.map((r) => r.key)).toEqual(["cafe-2026-01-02", "cafe-2026-01-03", "sexet-2026-01-02"]);
  });
});

describe("routeSwishPayments", () => {
  it("routes by the message, then by the amount guess, then to the reserv", () => {
    const got = routeSwishPayments(table(), [
      { date: "2026-01-02", message: "c - Bulle", amount: 2500 },
      { date: "2026-01-02", message: "", amount: 1300 },
      { date: "2026-01-02", message: "Tack för igår", amount: 5000 },
    ]);

    const cafe = got.find((r) => r.committee === "cafe")!;
    expect(cafe.products.map((p) => p.name)).toEqual(["Bulle", "Cola"]);
    const reserv = got.find((r) => r.committee === "skatt")!;
    expect(reserv.products[0]).toMatchObject({ name: "Tack för igår", account: "3990", total: 5000 });
  });
});

describe("groupZettleFees", () => {
  it("is one report per day on the fee account, equal fees counted on one line", () => {
    const got = groupZettleFees(
      [
        { date: "2026-01-02", amount: 150 },
        { date: "2026-01-02", amount: 150 },
        { date: "2026-01-02", amount: 0 },
        { date: "2026-01-03", amount: 200 },
      ],
      "6570",
    );

    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({ date: "2026-01-02", total: 300 });
    expect(got[0].fees).toEqual([{ name: "Zettle fee", account: "6570", quantity: 2, unitPrice: 150, total: 300 }]);
  });
});
