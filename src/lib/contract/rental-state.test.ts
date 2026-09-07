import { describe, expect, it } from "vitest";
import { rentalState, type RentalFacts } from "./rental-state";

// Every case is a date rule, so they are all asked on one day.
const TODAY = "2026-09-06";

const rental = (over: Partial<RentalFacts> = {}): RentalFacts => ({
  status: "SIGNED",
  pickupAt: "2026-09-01",
  returnAt: "2026-09-10",
  returnedAt: null,
  checkedAt: null,
  ...over,
});

describe("rentalState", () => {
  it("is upcoming before the pickup day", () => {
    expect(rentalState(rental({ pickupAt: "2026-09-20", returnAt: "2026-09-21" }), TODAY)).toBe(
      "UPCOMING",
    );
  });

  it("is out on the pickup day itself", () => {
    expect(rentalState(rental({ pickupAt: TODAY }), TODAY)).toBe("OUT");
  });

  it("is still out on the last day of the rental", () => {
    // returnAt is the day it is due, so it is not late until the day after.
    expect(rentalState(rental({ returnAt: TODAY }), TODAY)).toBe("OUT");
  });

  it("is overdue the day after it was due", () => {
    expect(rentalState(rental({ returnAt: "2026-09-05" }), TODAY)).toBe("OVERDUE");
  });

  it("stops being overdue once it is back, even if it came back late", () => {
    expect(
      rentalState(rental({ returnAt: "2026-09-01", returnedAt: "2026-09-05" }), TODAY),
    ).toBe("AWAITING_CHECK");
  });

  it("waits for the check before it is closed", () => {
    // The gap the villkor turn on: the section has the gear and has not yet
    // said whether it is undamaged.
    expect(rentalState(rental({ returnedAt: "2026-09-04" }), TODAY)).toBe("AWAITING_CHECK");
  });

  it("closes once it has been checked, which is the last thing anybody does", () => {
    // The deposit used to hold a checked rental open until it went back. The
    // section has never taken one, so accepting the gear is now the end of it.
    expect(
      rentalState(rental({ returnedAt: "2026-09-04", checkedAt: "2026-09-05" }), TODAY),
    ).toBe("CLOSED");
  });

  it("reports a cancelled rental as cancelled however overdue it looks", () => {
    // Nothing is out, so nothing is late.
    expect(
      rentalState(rental({ status: "CANCELLED", returnAt: "2020-01-01" }), TODAY),
    ).toBe("CANCELLED");
    expect(
      rentalState(rental({ status: "TERMINATED", returnAt: "2020-01-01" }), TODAY),
    ).toBe("CANCELLED");
  });

  it("treats a draft like any other rental for where the gear is", () => {
    // A draft still holds the gear as far as availability is concerned, so the
    // work list has to show it too.
    expect(rentalState(rental({ status: "DRAFT" }), TODAY)).toBe("OUT");
  });
});
