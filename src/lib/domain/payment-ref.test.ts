import { describe, expect, it } from "vitest";
import { giroDigits, giroMismatch, matchSupplier } from "./payment-ref";

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

describe("matchSupplier", () => {
  const s = (number: string, rest: Partial<{ orgNo: string; bankgiro: string; plusgiro: string; active: boolean }>) => ({
    number,
    orgNo: rest.orgNo ?? null,
    bankgiro: rest.bankgiro ?? null,
    plusgiro: rest.plusgiro ?? null,
    active: rest.active ?? true,
  });
  const register = [
    s("1", { orgNo: "556677-8899", bankgiro: "5050-1055" }),
    s("2", { orgNo: "802000-1111", plusgiro: "12 34 56-7" }),
    s("3", { bankgiro: "123-4567", active: false }),
    s("4", { bankgiro: "1234567" }),
  ];

  it("matches the org number whatever its punctuation", () => {
    expect(matchSupplier({ supplierOrgNo: "5566778899" }, register)?.number).toBe("1");
  });

  it("reads the org number out of a VAT number", () => {
    expect(matchSupplier({ supplierOrgNo: "SE556677889901" }, register)?.number).toBe("1");
  });

  it("falls back to the bankgiro, then the plusgiro", () => {
    expect(matchSupplier({ supplierOrgNo: "111111-1111", bankgiro: "50501055" }, register)?.number).toBe("1");
    expect(matchSupplier({ plusgiro: "1234567" }, register)?.number).toBe("2");
  });

  it("prefers an active supplier", () => {
    expect(matchSupplier({ bankgiro: "123-4567" }, register)?.number).toBe("4");
  });

  it("says nothing rather than guess", () => {
    expect(matchSupplier({}, register)).toBeNull();
    expect(matchSupplier({ supplierOrgNo: "999999-9999" }, register)).toBeNull();
  });
});
