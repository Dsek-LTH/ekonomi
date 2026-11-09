import { describe, expect, it } from "vitest";
import {
  bestBeforeOf,
  checkOf,
  isDue,
  lastEmptied,
  soonestCheck,
  type Delivery,
  type ShelfStep,
} from "./expiry";

const NOW = "2026-09-02";
const LEAD = 30;

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: "e1",
  occurredAt: "2026-01-01",
  bestBefore: "2026-10-01",
  checkedAt: null,
  ...over,
});

describe("bestBeforeOf", () => {
  it("counts in whole months, which is how the answer is known", () => {
    // A lager: nine months. A cider: twenty-one.
    expect(bestBeforeOf("2026-03-12", 9)).toBe("2026-12-12");
    expect(bestBeforeOf("2026-03-12", 21)).toBe("2027-12-12");
  });

  it("clamps to a day the month has", () => {
    expect(bestBeforeOf("2026-05-31", 9)).toBe("2027-02-28");
    expect(bestBeforeOf("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("says nothing about a product nobody has given a shelf life", () => {
    expect(bestBeforeOf("2026-03-12", null)).toBeNull();
    expect(bestBeforeOf("2026-03-12", undefined)).toBeNull();
    expect(bestBeforeOf("2026-03-12", 0)).toBeNull();
  });
});

describe("checkOf", () => {
  it("dates every delivery, and says which are owed", () => {
    const soon = checkOf(delivery(), LEAD, null, NOW)!;
    expect(soon).toMatchObject({ state: "soon", daysLeft: 29 });
    expect(isDue(soon)).toBe(true);

    const later = checkOf(delivery({ bestBefore: "2026-11-02" }), LEAD, null, NOW)!;
    expect(later).toMatchObject({ state: "later", daysLeft: 61 });
    expect(isDue(later)).toBe(false);
  });

  it("keeps asking once the date is past", () => {
    const check = checkOf(delivery({ bestBefore: "2026-08-01" }), LEAD, null, NOW)!;
    expect(check).toMatchObject({ state: "over", daysLeft: -32 });
    expect(isDue(check)).toBe(true);
  });

  it("says nothing at all about something that does not go off", () => {
    expect(checkOf(delivery({ bestBefore: null }), LEAD, null, NOW)).toBeNull();
  });

  it("drops a delivery the shelf has been empty since", () => {
    expect(checkOf(delivery(), LEAD, "2026-02-01", NOW)).toBeNull();
    expect(checkOf(delivery(), LEAD, "2025-12-31", NOW)).not.toBeNull();
    expect(checkOf(delivery(), LEAD, "2026-01-01", NOW)).toBeNull();
  });

  it("goes quiet for a lead time when somebody has looked at that delivery", () => {
    const seen = checkOf(delivery({ checkedAt: "2026-08-20" }), LEAD, null, NOW)!;
    expect(seen).toMatchObject({ quiet: true, checkedAt: "2026-08-20" });
    expect(isDue(seen)).toBe(false);

    const stale = checkOf(delivery({ checkedAt: "2026-07-20" }), LEAD, null, NOW)!;
    expect(stale.quiet).toBe(false);
    expect(isDue(stale)).toBe(true);
  });
});

describe("soonestCheck", () => {
  it("shows the one at the back of the shelf", () => {
    const checks = [
      checkOf(delivery({ id: "a", bestBefore: "2026-09-20" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "b", bestBefore: "2026-08-01" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "c", bestBefore: "2026-09-10" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(checks)?.entryId).toBe("b");
  });

  it("passes over the ones that are not owed", () => {
    const checks = [
      checkOf(delivery({ id: "later", bestBefore: "2026-12-01" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "seen", checkedAt: "2026-08-25" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(checks)).toBeNull();

    const mixed = [
      checkOf(
        delivery({ id: "seen", bestBefore: "2026-09-05", checkedAt: "2026-08-25" }),
        LEAD,
        null,
        NOW,
      )!,
      checkOf(delivery({ id: "owed", bestBefore: "2026-09-25" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(mixed)?.entryId).toBe("owed");
  });

  it("has no answer where nothing is due", () => {
    expect(soonestCheck([])).toBeNull();
  });
});

describe("lastEmptied", () => {
  const step = (occurredAt: string, units: number, openUnits = 0): ShelfStep => ({
    occurredAt,
    units,
    openUnits,
  });

  it("finds the last day nothing was on the shelf", () => {
    expect(
      lastEmptied([
        step("2026-01-01", 24),
        step("2026-02-01", -24),
        step("2026-03-01", 24),
        step("2026-04-01", -12),
      ]),
    ).toBe("2026-02-01");
  });

  it("reads the day at its end, not row by row", () => {
    expect(lastEmptied([step("2026-02-01", 24), step("2026-02-01", -12)])).toBeNull();
    expect(lastEmptied([step("2026-02-01", -12), step("2026-02-01", 24)])).toBeNull();

    expect(lastEmptied([step("2026-02-01", 24), step("2026-02-01", -24)])).toBe("2026-02-01");
    expect(lastEmptied([step("2026-02-01", -24), step("2026-02-01", 24)])).toBe("2026-02-01");
  });

  it("counts open bottles as stock", () => {
    expect(lastEmptied([step("2026-01-01", 1), step("2026-02-01", -1, 1)])).toBeNull();
  });

  it("has no answer for a product that has never run out", () => {
    expect(lastEmptied([step("2026-01-01", 24), step("2026-02-01", -12)])).toBeNull();
    expect(lastEmptied([])).toBeNull();
  });

  it("treats a log that has gone negative as empty", () => {
    expect(lastEmptied([step("2026-01-01", 24), step("2026-02-01", -30)])).toBe("2026-02-01");
  });

  describe("with an opening balance", () => {
    const whole = [
      step("2026-01-01", 24),
      step("2026-02-01", -24),
      step("2026-03-01", 24),
      step("2026-04-01", -12),
    ];

    it("answers the same as the whole log when the empty day is inside the window", () => {
      expect(lastEmptied(whole)).toBe("2026-02-01");
      expect(lastEmptied(whole.slice(1), 24)).toBe("2026-02-01");
    });

    it("reports nothing when the shelf only emptied before the window", () => {
      expect(lastEmptied(whole.slice(2), 0)).toBeNull();
    });

    it("carries the opening balance into the first day", () => {
      expect(lastEmptied([step("2026-05-01", -24)], 24)).toBe("2026-05-01");
      expect(lastEmptied([step("2026-05-01", -24)], 36)).toBeNull();
    });

    it("defaults to nothing on the shelf, which is the whole-log case", () => {
      expect(lastEmptied(whole, 0)).toBe(lastEmptied(whole));
    });
  });
});
