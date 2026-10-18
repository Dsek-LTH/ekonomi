import { describe, expect, it } from "vitest";
import { likelyDuplicates, type ExpenseFingerprint } from "./duplicates";

const fp = (id: string, grossAmount: number, purchaseDate: string): ExpenseFingerprint => ({
  id,
  title: id,
  grossAmount,
  purchaseDate,
});

const mine = [fp("a", 320, "2026-10-12"), fp("b", 89.5, "2026-10-01"), fp("c", -320, "2026-10-12")];

describe("likelyDuplicates", () => {
  it("finds the same amount within three days", () => {
    expect(likelyDuplicates(mine, { grossAmount: 320, purchaseDate: "2026-10-15" }).map((e) => e.id)).toEqual(["a"]);
  });

  it("lets a fourth day go", () => {
    expect(likelyDuplicates(mine, { grossAmount: 320, purchaseDate: "2026-10-16" })).toEqual([]);
  });

  it("does not take a return for the purchase it returns", () => {
    expect(likelyDuplicates(mine, { grossAmount: -320, purchaseDate: "2026-10-12" }).map((e) => e.id)).toEqual(["c"]);
  });

  it("matches öre exactly, not through a float", () => {
    expect(likelyDuplicates(mine, { grossAmount: 89.5, purchaseDate: "2026-10-01" }).map((e) => e.id)).toEqual(["b"]);
    expect(likelyDuplicates(mine, { grossAmount: 89.51, purchaseDate: "2026-10-01" })).toEqual([]);
  });

  it("leaves out the utlägg being edited", () => {
    expect(likelyDuplicates(mine, { grossAmount: 320, purchaseDate: "2026-10-12", excludeId: "a" })).toEqual([]);
  });

  it("says nothing until there is an amount and a date", () => {
    expect(likelyDuplicates(mine, { grossAmount: 0, purchaseDate: "2026-10-12" })).toEqual([]);
    expect(likelyDuplicates(mine, { grossAmount: 320, purchaseDate: "" })).toEqual([]);
  });
});
