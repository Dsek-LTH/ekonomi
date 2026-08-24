import { describe, expect, it } from "vitest";
import { differs, replay, type ReplayRow } from "./replay";

const row = (r: Partial<ReplayRow> & { id: string }): ReplayRow => ({
  kind: "PURCHASE",
  level: 0,
  units: 0,
  open: {},
  valueDeltaOre: 0,
  ...r,
});

describe("replay", () => {
  it("leaves ordinary movements as they were typed", () => {
    const out = replay([row({ id: "a", units: 100 }), row({ id: "b", kind: "CHECKOUT", units: -20 })], 0);
    expect(out.get("a")?.units).toBe(100);
    expect(out.get("b")?.units).toBe(-20);
  });

  it("turns a count into the difference that reaches it", () => {
    // Books say 100, shelf holds 90.
    const out = replay([row({ id: "a", units: 100 }), row({ id: "c", kind: "COUNT", countedQty: 90 })], 0);
    expect(out.get("c")?.units).toBe(-10);
  });

  it("keeps a count true when something before it changes", () => {
    // The whole reason this exists. The delivery was 200 and is corrected to
    // 20; the count still said 90, so the difference has to become +70 or the
    // shelf reads 20 for a product somebody physically counted at 90.
    const before = replay([row({ id: "a", units: 200 }), row({ id: "c", kind: "COUNT", countedQty: 90 })], 0);
    const after = replay([row({ id: "a", units: 20 }), row({ id: "c", kind: "COUNT", countedQty: 90 })], 0);
    expect(before.get("c")?.units).toBe(-110);
    expect(after.get("c")?.units).toBe(70);
    // Either way the shelf comes to what was counted.
    expect(200 + before.get("c")!.units).toBe(90);
    expect(20 + after.get("c")!.units).toBe(90);
  });

  it("makes everything before a count stop mattering to the shelf", () => {
    // Which is the property somebody editing an old delivery is relying on.
    const totalAfter = (delivery: number) => {
      const rows = [
        row({ id: "a", units: delivery }),
        row({ id: "c", kind: "COUNT", countedQty: 90 }),
        row({ id: "d", kind: "CHECKOUT", units: -12 }),
      ];
      const out = replay(rows, 0);
      return rows.reduce((n, r) => n + out.get(r.id)!.units, 0);
    };
    expect(totalAfter(200)).toBe(78);
    expect(totalAfter(20)).toBe(78);
    expect(totalAfter(1)).toBe(78);
  });

  it("counts each rung against its own running total", () => {
    const out = replay(
      [
        row({ id: "a", kind: "RETURN", level: 40, open: { 40: 3 } }),
        row({ id: "c", kind: "COUNT", level: 40, countedQty: 2 }),
      ],
      0,
    );
    expect(out.get("c")?.open).toEqual({ 40: -1 });
    expect(out.get("c")?.units).toBe(0);
  });

  it("leaves an older count that never recorded what it counted", () => {
    // Written before a count was a statement rather than a difference. Nothing
    // says what it was counting, so guessing would be worse than leaving it.
    const out = replay([row({ id: "a", units: 100 }), row({ id: "c", kind: "COUNT", units: -10 })], 0);
    expect(out.get("c")?.units).toBe(-10);
  });

  it("re-prices what leaves after a delivery that changed", () => {
    const out = replay(
      [row({ id: "a", units: 10 }), row({ id: "b", kind: "CHECKOUT", units: -2 })],
      1000,
    );
    expect(out.get("a")?.valueDeltaOre).toBe(10_000);
    expect(out.get("b")?.valueDeltaOre).toBe(-2000);
  });

  it("takes the value to exactly nothing when the last of it leaves", () => {
    const rows = [
      row({ id: "a", units: 3 }),
      row({ id: "b", kind: "CHECKOUT", units: -1 }),
      row({ id: "c", kind: "CHECKOUT", units: -2 }),
    ];
    const out = replay(rows, 3334);
    expect(rows.reduce((n, r) => n + out.get(r.id)!.valueDeltaOre, 0)).toBe(0);
  });

  it("has nothing to say about an empty log", () => {
    expect(replay([], 1000).size).toBe(0);
  });
});

describe("differs", () => {
  it("spots a row whose figure has moved", () => {
    const r = row({ id: "a", units: 10, valueDeltaOre: 100 });
    expect(differs(r, { units: 10, open: {}, valueDeltaOre: 100 })).toBe(false);
    expect(differs(r, { units: 11, open: {}, valueDeltaOre: 100 })).toBe(true);
    expect(differs(r, { units: 10, open: {}, valueDeltaOre: 90 })).toBe(true);
    expect(differs(r, { units: 10, open: { 40: 1 }, valueDeltaOre: 100 })).toBe(true);
  });
});
