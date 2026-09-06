import { describe, expect, it } from "vitest";
import { canEditRental, displayStatus, isExpired } from "./status";

// Every case here is about a date rule, so it is asked on one fixed day.
const TODAY = "2026-09-06";

describe("isExpired", () => {
  it("is true for a signed contract whose last day has passed", () => {
    expect(isExpired({ status: "SIGNED", validTo: "2026-09-05" }, TODAY)).toBe(true);
  });

  it("is false on the last day itself", () => {
    // validTo is inclusive: a contract valid to the 6th is in force on the 6th.
    expect(isExpired({ status: "SIGNED", validTo: TODAY }, TODAY)).toBe(false);
  });

  it("is false without an end date", () => {
    expect(isExpired({ status: "SIGNED", validTo: null }, TODAY)).toBe(false);
  });

  it("does not expire a draft, however old", () => {
    // An abandoned draft is not a contract that needs renewing.
    expect(isExpired({ status: "DRAFT", validTo: "2019-01-01" }, TODAY)).toBe(false);
  });

  it("leaves an already-ended contract saying how it ended", () => {
    expect(isExpired({ status: "TERMINATED", validTo: "2019-01-01" }, TODAY)).toBe(false);
    expect(isExpired({ status: "CANCELLED", validTo: "2019-01-01" }, TODAY)).toBe(false);
  });
});

describe("displayStatus", () => {
  it("reports the stored status when nothing has lapsed", () => {
    expect(displayStatus({ status: "OUT_FOR_SIGNATURE", validTo: null }, TODAY)).toBe(
      "OUT_FOR_SIGNATURE",
    );
  });

  it("reports EXPIRED in place of SIGNED once the end date is past", () => {
    expect(displayStatus({ status: "SIGNED", validTo: "2020-06-30" }, TODAY)).toBe("EXPIRED");
  });
});

describe("canEditRental", () => {
  it("allows edits only while the contract is a draft", () => {
    expect(canEditRental("DRAFT")).toBe(true);
    // Once it is out, the counterparty is reading it.
    expect(canEditRental("OUT_FOR_SIGNATURE")).toBe(false);
    expect(canEditRental("SIGNED")).toBe(false);
    expect(canEditRental("TERMINATED")).toBe(false);
    expect(canEditRental("CANCELLED")).toBe(false);
  });
});
