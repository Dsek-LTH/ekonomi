import { describe, expect, it } from "vitest";
import { grantPeriod, grantState, lastDay, stockholmMidnight } from "./access-grant";

// 2026-11-17 14:00 in Stockholm (CET, UTC+1).
const NOW = new Date("2026-11-17T13:00:00Z");

describe("stockholmMidnight", () => {
  it("is 23:00 UTC the day before in winter", () => {
    expect(stockholmMidnight("2026-11-18").toISOString()).toBe("2026-11-17T23:00:00.000Z");
  });

  it("is 22:00 UTC the day before in summer", () => {
    expect(stockholmMidnight("2026-07-01").toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("follows the clock change on the day of it", () => {
    // Summer time starts 2026-03-29 at 02:00, so that midnight is still CET.
    expect(stockholmMidnight("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(stockholmMidnight("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
  });
});

describe("grantPeriod", () => {
  it("starts now and runs until removed when no days are named", () => {
    expect(grantPeriod(null, null, NOW)).toEqual({ ok: true, validFrom: NOW, validUntil: null });
  });

  it("includes the last day named in full", () => {
    const p = grantPeriod(null, "2026-11-20", NOW);
    expect(p.ok && p.validUntil?.toISOString()).toBe("2026-11-20T23:00:00.000Z");
  });

  it("can end today", () => {
    const p = grantPeriod(null, "2026-11-17", NOW);
    expect(p.ok && p.validUntil?.toISOString()).toBe("2026-11-17T23:00:00.000Z");
  });

  it("starts at midnight on a later day", () => {
    const p = grantPeriod("2026-11-20", "2026-11-22", NOW);
    expect(p.ok && p.validFrom.toISOString()).toBe("2026-11-19T23:00:00.000Z");
  });

  it("is never backdated", () => {
    const p = grantPeriod("2026-11-01", null, NOW);
    expect(p.ok && p.validFrom).toEqual(NOW);
  });

  it("refuses an end that has passed", () => {
    expect(grantPeriod(null, "2026-11-16", NOW)).toEqual({ ok: false, error: "grant.endsInPast" });
  });

  it("refuses an end before the start", () => {
    expect(grantPeriod("2026-11-25", "2026-11-20", NOW)).toEqual({
      ok: false,
      error: "grant.endsBeforeStart",
    });
  });
});

describe("grantState", () => {
  it("tells running, waiting and over apart", () => {
    const later = new Date("2026-11-20T00:00:00Z");
    const earlier = new Date("2026-11-10T00:00:00Z");
    expect(grantState({ validFrom: earlier, validUntil: null }, NOW)).toBe("active");
    expect(grantState({ validFrom: later, validUntil: null }, NOW)).toBe("scheduled");
    expect(grantState({ validFrom: earlier, validUntil: earlier }, NOW)).toBe("ended");
  });
});

describe("lastDay", () => {
  it("gives back the day the form named", () => {
    const p = grantPeriod(null, "2026-11-20", NOW);
    expect(p.ok && lastDay(p.validUntil)).toBe("2026-11-20");
    expect(lastDay(null)).toBeNull();
  });
});
