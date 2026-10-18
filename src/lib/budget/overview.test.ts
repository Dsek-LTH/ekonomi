import { describe, expect, it } from "vitest";
import { buildOverview, paceOf, totalOf } from "./overview";

const unitOf = (code: string) => (code.startsWith("SEX") ? "Sexmästeriet" : null);
const names = new Map([
  ["SEX01", "Sittningar"],
  ["SEX02", "Pubar"],
]);
const booked = (account: string, costCenterCode: string | null, debit: number, credit = 0) => ({
  account,
  costCenterCode,
  debit,
  credit,
});

describe("buildOverview", () => {
  it("reads income and cost positive, in SEK, from net öre", () => {
    const [unit] = buildOverview(
      // Budget: income is a credit (negative net), cost a debit.
      [
        ["3010|SEX01", -1_000_000],
        ["4010|SEX01", 600_000],
      ],
      [booked("3010", "SEX01", 0, 250_000), booked("4010", "SEX01", 400_000)],
      unitOf,
      names,
    );
    expect(unit.name).toBe("Sexmästeriet");
    expect(unit.income).toEqual({ budget: 10_000, actual: 2_500 });
    expect(unit.cost).toEqual({ budget: 6_000, actual: 4_000 });
    expect(unit.costCenters[0]).toMatchObject({ code: "SEX01", name: "Sittningar" });
  });

  it("sums cost centres into their unit and sorts them by code", () => {
    const [unit] = buildOverview(
      [],
      [booked("4010", "SEX02", 100_00), booked("4010", "SEX01", 300_00)],
      unitOf,
      names,
    );
    expect(unit.costCenters.map((c) => c.code)).toEqual(["SEX01", "SEX02"]);
    expect(unit.cost.actual).toBe(400);
  });

  it("leaves balance accounts out", () => {
    const units = buildOverview([], [booked("1930", "SEX01", 999_00)], unitOf, names);
    expect(units).toEqual([]);
  });

  it("puts unclaimed and cost-centreless rows in a unit of their own, last", () => {
    const units = buildOverview(
      [],
      [
        booked("4010", "XYZ", 100_00),
        booked("4010", null, 50_00),
        booked("4010", "SEX01", 10_00),
      ],
      unitOf,
      names,
    );
    expect(units.map((u) => u.name)).toEqual(["Sexmästeriet", null]);
    expect(units[1].costCenters.map((c) => c.code)).toEqual(["XYZ", ""]);
  });

  it("drops a cost centre that nets to nothing on both sides", () => {
    const units = buildOverview(
      [],
      [booked("4010", "SEX01", 100_00), booked("4010", "SEX01", 0, 100_00)],
      unitOf,
      names,
    );
    expect(units).toEqual([]);
  });
});

describe("paceOf", () => {
  it("is over once the budget is spent past", () => {
    expect(paceOf({ budget: 100, actual: 101 }, 0.5)).toBe("OVER");
  });
  it("is ahead when spending outruns the year by more than a tenth", () => {
    expect(paceOf({ budget: 100, actual: 61 }, 0.5)).toBe("AHEAD");
    expect(paceOf({ budget: 100, actual: 60 }, 0.5)).toBe("ON_TRACK");
  });
  it("has nothing to say without a cost budget", () => {
    expect(paceOf({ budget: 0, actual: 50 }, 0.5)).toBeNull();
  });
});

describe("totalOf", () => {
  it("adds both sides of every unit", () => {
    const f = (budget: number, actual: number) => ({ budget, actual });
    expect(
      totalOf([
        { income: f(10, 5), cost: f(20, 8) },
        { income: f(1, 1), cost: f(2, 2) },
      ]),
    ).toEqual({ income: f(11, 6), cost: f(22, 10) });
  });
});
