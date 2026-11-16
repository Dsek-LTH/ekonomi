import { describe, expect, it } from "vitest";
import {
  bucketsThrough,
  classOf,
  fingerprint,
  outstanding,
  planPosting,
  voucherLines,
  type Bucket,
  type PostingAccounts,
} from "./posting";

const accounts: PostingAccounts = {
  purchaseOffsetAccount: "4010",
  boardCostAccount: "4090",
  groups: new Map([
    [
      "beer",
      {
        stockAccount: "1461",
        consumptionAccount: "4011",
        lossAccount: null,
        countDiffAccount: null,
      },
    ],
    [
      "wine",
      {
        stockAccount: "1463",
        consumptionAccount: "4013",
        lossAccount: "4093",
        countDiffAccount: null,
      },
    ],
  ]),
};

const b = (over: Partial<Bucket>): Bucket => ({
  date: "2027-01-08",
  class: "CONSUMPTION",
  groupId: "beer",
  costCenterId: null,
  amountOre: -400_000,
  ...over,
});

const balanced = (lines: { debit: number; credit: number }[]) =>
  lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

describe("classOf", () => {
  it("leaves a delivery out where purchases already debit the stock account", () => {
    expect(classOf("PURCHASE", "CAPITALISED")).toBeNull();
    expect(classOf("PURCHASE", "EXPENSED")).toBe("PURCHASE");
  });

  it("books a night's checkout and its return as the same thing, so they net", () => {
    expect(classOf("CHECKOUT", "CAPITALISED")).toBe("CONSUMPTION");
    expect(classOf("RETURN", "CAPITALISED")).toBe("CONSUMPTION");
    expect(classOf("ISSUE", "EXPENSED")).toBe("CONSUMPTION");
  });

  it("leaves a spill at a night out, since the checkout already took it", () => {
    expect(classOf("WASTE", "CAPITALISED")).toBeNull();
  });
});

describe("outstanding", () => {
  it("is nothing for a day that was sent as the log still says", () => {
    expect(outstanding([b({})], [b({})])).toEqual([]);
  });

  it("is the difference when a sent day has changed", () => {
    expect(outstanding([b({ amountOre: -400_350 })], [b({})])).toEqual([b({ amountOre: -350 })]);
  });

  it("takes back what was sent for a movement that is gone", () => {
    expect(outstanding([], [b({})])).toEqual([b({ amountOre: 400_000 })]);
  });

  it("moves value between stock accounts when a product changes type", () => {
    const due = outstanding([b({ groupId: "wine" })], [b({ groupId: "beer" })]);
    expect(due).toEqual([b({ groupId: "beer", amountOre: 400_000 }), b({ groupId: "wine" })]);
  });
});

describe("bucketsThrough", () => {
  it("adds up every unsent day up to the date, and leaves the later ones", () => {
    const plan = planPosting(
      [
        b({ date: "2027-01-08", amountOre: -100 }),
        b({ date: "2027-01-09", amountOre: -50 }),
        b({ date: "2027-01-12", amountOre: -7 }),
      ],
      null,
    );
    expect(bucketsThrough(plan.days, "2027-01-10")).toEqual([
      b({ date: "2027-01-08", amountOre: -100 }),
      b({ date: "2027-01-09", amountOre: -50 }),
    ]);
  });
});

describe("planPosting", () => {
  const friday = b({ date: "2027-01-08" });
  const saturday = b({ date: "2027-01-09", amountOre: 150_000 });

  it("lists each unsent day, oldest first", () => {
    const plan = planPosting([saturday, friday], null);
    expect(plan.days.map((d) => d.date)).toEqual(["2027-01-08", "2027-01-09"]);
    expect(plan.corrections).toEqual([]);
  });

  it("corrects anything on or before the last export instead of sending it again", () => {
    // Exported through Friday, then Friday changed: a correction. Saturday was never covered.
    const plan = planPosting([friday, saturday], "2027-01-08");
    expect(plan.days.map((d) => d.date)).toEqual(["2027-01-09"]);
    expect(plan.corrections).toEqual([friday]);
  });

  it("corrects a day before the last export even if it had nothing then", () => {
    // A pub typed in late, dated before a later export: that export already covered its day.
    const plan = planPosting([friday], "2027-01-31");
    expect(plan.days).toEqual([]);
    expect(plan.corrections).toEqual([friday]);
  });

  it("corrects a day Fortnox will no longer take", () => {
    const plan = planPosting([friday], null, (date) => date >= "2027-01-09");
    expect(plan.days).toEqual([]);
    expect(plan.corrections).toEqual([friday]);
  });
});

describe("voucherLines", () => {
  it("moves what left from the type's stock account to its cost account", () => {
    const made = voucherLines([b({ costCenterId: "pub" })], accounts);
    expect(made).toEqual({
      ok: true,
      lines: [
        { account: "4011", costCenterId: "pub", description: null, debit: 400_000, credit: 0 },
        { account: "1461", costCenterId: null, description: null, debit: 0, credit: 400_000 },
      ],
    });
  });

  it("nets a return against a checkout on the same accounts", () => {
    const made = voucherLines([b({}), b({ amountOre: 150_000 })], accounts);
    if (!made.ok) throw new Error("expected lines");
    expect(made.lines).toEqual([
      { account: "4011", costCenterId: null, description: null, debit: 250_000, credit: 0 },
      { account: "1461", costCenterId: null, description: null, debit: 0, credit: 250_000 },
    ]);
  });

  it("writes one voucher over several product types, and it balances", () => {
    const made = voucherLines(
      [
        b({}),
        b({ groupId: "wine", amountOre: -90_000 }),
        b({ groupId: "wine", class: "LOSS", amountOre: -30_000 }),
      ],
      accounts,
    );
    if (!made.ok) throw new Error("expected lines");
    expect(balanced(made.lines)).toBe(true);
    expect(made.lines.map((l) => l.account).sort()).toEqual([
      "1461",
      "1463",
      "4011",
      "4013",
      "4093",
    ]);
  });

  it("charges spoilage on the type's cost account where it has no spoilage account", () => {
    const made = voucherLines([b({ class: "LOSS", amountOre: -30_000 })], accounts);
    if (!made.ok) throw new Error("expected lines");
    expect(made.lines[0].account).toBe("4011");
  });

  it("takes a delivery into an expensed stock by crediting the purchase account", () => {
    const made = voucherLines([b({ class: "PURCHASE", amountOre: 240_000 })], accounts);
    if (!made.ok) throw new Error("expected lines");
    expect(made.lines).toEqual([
      { account: "1461", costCenterId: null, description: null, debit: 240_000, credit: 0 },
      { account: "4010", costCenterId: null, description: null, debit: 0, credit: 240_000 },
    ]);
  });

  it("keeps a correction's rows apart by the day they are for", () => {
    const made = voucherLines(
      [b({ date: "2027-01-08", amountOre: -100 }), b({ date: "2027-01-09", amountOre: -200 })],
      accounts,
      (x) => `Rättelse ${x.date}`,
    );
    if (!made.ok) throw new Error("expected lines");
    expect(made.lines).toHaveLength(4);
    expect(balanced(made.lines)).toBe(true);
  });

  it("names what is missing instead of guessing an account", () => {
    const bare: PostingAccounts = { ...accounts, boardCostAccount: null };
    expect(voucherLines([b({ class: "BOARD" })], bare)).toEqual({
      ok: false,
      missing: { class: "BOARD", groupId: "beer" },
    });
    expect(voucherLines([b({ groupId: "cider" })], accounts)).toEqual({
      ok: false,
      missing: { class: "STOCK", groupId: "cider" },
    });
  });
});

describe("fingerprint", () => {
  it("is the same for the same figures in any order, and changes with them", () => {
    const one = [b({}), b({ groupId: "wine" })];
    expect(fingerprint(one)).toBe(fingerprint([...one].reverse()));
    expect(fingerprint(one)).not.toBe(fingerprint([b({ amountOre: -1 }), b({ groupId: "wine" })]));
  });
});
