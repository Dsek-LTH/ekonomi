import { describe, expect, it } from "vitest";
import { rentalState, type RentalFacts } from "./rental-state";

const TODAY = "2026-09-06";

const rental = (over: Partial<RentalFacts> = {}): RentalFacts => ({
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
    expect(rentalState(rental({ returnAt: TODAY }), TODAY)).toBe("OUT");
  });

  it("is overdue the day after it was due", () => {
    expect(rentalState(rental({ returnAt: "2026-09-05" }), TODAY)).toBe("OVERDUE");
  });

  it("stops being overdue once it is back, even if it came back late", () => {
    expect(rentalState(rental({ returnAt: "2026-09-01", returnedAt: "2026-09-05" }), TODAY)).toBe(
      "AWAITING_CHECK",
    );
  });

  it("waits for the check before it is closed", () => {
    // The gap the villkor turn on: returned but not yet accepted.
    expect(rentalState(rental({ returnedAt: "2026-09-04" }), TODAY)).toBe("AWAITING_CHECK");
  });

  it("closes once it has been checked, which is the last thing anybody does", () => {
    expect(rentalState(rental({ returnedAt: "2026-09-04", checkedAt: "2026-09-05" }), TODAY)).toBe(
      "CLOSED",
    );
  });
});
