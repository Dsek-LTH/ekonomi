import { describe, expect, it } from "vitest";
import { giroDigits, giroMismatch } from "./payment-ref";

describe("giroDigits", () => {
  it("reads a giro number however it is written", () => {
    expect(giroDigits("5050-1055")).toBe("50501055");
    expect(giroDigits("5050 1055")).toBe("50501055");
    expect(giroDigits("")).toBeNull();
    expect(giroDigits(null)).toBeNull();
  });
});

describe("giroMismatch", () => {
  const register = { bankgiro: "5050-1055", plusgiro: null };

  it("passes an invoice paid where the register says, however it is written", () => {
    expect(giroMismatch({ bankgiro: "50501055", plusgiro: null }, register)).toBeNull();
  });

  it("passes an invoice that names no giro at all", () => {
    expect(giroMismatch({ bankgiro: null, plusgiro: null }, register)).toBeNull();
  });

  it("stops a bankgiro the register does not have", () => {
    expect(giroMismatch({ bankgiro: "123-4567", plusgiro: null }, register)).toEqual({
      kind: "differs",
      field: "bankgiro",
      invoice: "123-4567",
      register: "5050-1055",
    });
  });

  it("stops a giro for a supplier the register has none for", () => {
    expect(giroMismatch({ bankgiro: null, plusgiro: "12345-6" }, register)).toMatchObject({
      field: "plusgiro",
      register: null,
    });
  });
});
