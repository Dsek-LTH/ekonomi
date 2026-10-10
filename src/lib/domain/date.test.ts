import { afterEach, describe, expect, it, vi } from "vitest";
import { daysAgo, isCompleteDate, isFutureDate, isoWeek, today } from "./date";

describe("isCompleteDate", () => {
  it("accepts a whole ISO date", () => {
    expect(isCompleteDate("2026-07-01")).toBe(true);
    expect(isCompleteDate("2024-02-29")).toBe(true); // a leap day is a real day
  });

  it("rejects a date still being typed", () => {
    // What the masked field leaves behind on the way to a full date. `new Date`
    // reads both, as 1 January and 1 July, which is the whole reason for this.
    expect(isCompleteDate("")).toBe(false);
    expect(isCompleteDate("2026")).toBe(false);
    expect(isCompleteDate("2026-0")).toBe(false);
    expect(isCompleteDate("2026-07")).toBe(false);
    expect(isCompleteDate("2026-07-0")).toBe(false);
  });

  it("rejects a day that doesn't exist", () => {
    expect(isCompleteDate("2026-02-30")).toBe(false);
    expect(isCompleteDate("2026-13-01")).toBe(false);
    expect(isCompleteDate("2025-02-29")).toBe(false);
  });

  it("rejects anything that isn't the plain date form", () => {
    expect(isCompleteDate("2026-7-1")).toBe(false);
    expect(isCompleteDate("01/07/2026")).toBe(false);
    expect(isCompleteDate("2026-07-01T12:00:00Z")).toBe(false);
  });
});

describe("isFutureDate", () => {
  afterEach(() => vi.useRealTimers());

  it("accepts today and every day before it", () => {
    expect(isFutureDate("2026-08-03", "2026-08-03")).toBe(false);
    expect(isFutureDate("2026-08-02", "2026-08-03")).toBe(false);
    expect(isFutureDate("2025-12-31", "2026-08-03")).toBe(false);
  });

  it("rejects tomorrow and beyond", () => {
    expect(isFutureDate("2026-08-04", "2026-08-03")).toBe(true);
    expect(isFutureDate("2026-09-01", "2026-08-03")).toBe(true);
    // The typo this is really for: a year typed one ahead.
    expect(isFutureDate("2027-08-03", "2026-08-03")).toBe(true);
  });

  it("leaves a half-typed date to isCompleteDate", () => {
    expect(isFutureDate("", "2026-08-03")).toBe(false);
    expect(isFutureDate("2027", "2026-08-03")).toBe(false);
    expect(isFutureDate("2027-09", "2026-08-03")).toBe(false);
  });

  it("counts the day in Stockholm, not the host's UTC day", () => {
    // 01:30 on 3 August in Stockholm (summer time, UTC+2), a purchase made an
    // hour ago. A server reading its own UTC clock still says 2 August here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T23:30:00Z"));
    expect(today()).toBe("2026-08-03");
    expect(isFutureDate("2026-08-03")).toBe(false);
    expect(isFutureDate("2026-08-04")).toBe(true);
  });
});

describe("daysAgo", () => {
  it("counts whole days back from today", () => {
    expect(daysAgo("2026-08-03", "2026-08-03")).toBe(0);
    expect(daysAgo("2026-08-02", "2026-08-03")).toBe(1);
    expect(daysAgo("2026-06-04", "2026-08-03")).toBe(60);
    expect(daysAgo("2026-06-03", "2026-08-03")).toBe(61);
  });

  it("counts a day still to come as negative", () => {
    expect(daysAgo("2026-08-04", "2026-08-03")).toBe(-1);
  });

  it("is unmoved by the clocks changing between the two days", () => {
    // Sweden went back an hour on 25 October 2026. Counted in local time the
    // span below would be 60 days and one hour, which is how a deadline check
    // starts letting day 61 through.
    expect(daysAgo("2026-10-01", "2026-11-30")).toBe(60);
  });
});

describe("isoWeek", () => {
  it("runs Monday to Sunday, so a Sunday digest and the Monday after are different weeks", () => {
    expect(isoWeek("2026-10-05")).toBe("2026-W41");
    expect(isoWeek("2026-10-11")).toBe("2026-W41");
    expect(isoWeek("2026-10-04")).toBe("2026-W40");
  });

  it("gives a week that crosses New Year to the year its Thursday is in", () => {
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
  });
});
