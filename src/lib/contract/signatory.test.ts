import { describe, expect, it } from "vitest";
import { rentalTitle } from "./signatory";

describe("rentalTitle", () => {
  it("says what it is and who it is with", () => {
    expect(rentalTitle("W-sektionen inom TLTH")).toBe("Uthyrning till W-sektionen inom TLTH");
  });

  it("trims what was typed", () => {
    expect(rentalTitle("  F-sektionen  ")).toBe("Uthyrning till F-sektionen");
  });

  it("still gives a title when the renter is blank", () => {
    // The archive list needs something to draw. A row titled "" is a row
    // nobody can find again.
    expect(rentalTitle("")).toBe("Uthyrning");
    expect(rentalTitle("   ")).toBe("Uthyrning");
  });
});
