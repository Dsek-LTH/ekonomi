import { describe, expect, it } from "vitest";
import { cancelsOut } from "./matching";

// A bank transaction settles an utlägg only when the two cancel exactly: the
// purchase is +250 on the utlägg and −250 in the bank.
describe("cancelsOut", () => {
  it("matches a purchase against the money leaving the account", () => {
    expect(cancelsOut(-250, 250)).toBe(true);
  });

  it("matches a return against the money coming back", () => {
    expect(cancelsOut(250, -250)).toBe(true);
  });

  it("refuses a row of the right size in the wrong direction", () => {
    // Two outgoing amounts do not settle each other, however equal they look in
    // a list — and a refund can only settle a return.
    expect(cancelsOut(-250, -250)).toBe(false);
    expect(cancelsOut(250, 250)).toBe(false);
  });

  it("refuses a near miss", () => {
    // The mistyped amount is the case this exists to catch: 249,50 against a
    // 250 kr utlägg stays unselectable, which is what tells the submitter the
    // amount is wrong rather than the transaction missing.
    expect(cancelsOut(-249.5, 250)).toBe(false);
    expect(cancelsOut(-250.01, 250)).toBe(false);
  });

  it("has nothing to settle against a zero amount", () => {
    // A draft with no amount typed yet would otherwise match every zero-sum
    // pairing.
    expect(cancelsOut(0, 0)).toBe(false);
    expect(cancelsOut(-250, 0)).toBe(false);
  });

  it("absorbs float noise from the client's SEK arithmetic", () => {
    expect(cancelsOut(-250.004, 250)).toBe(true);
    expect(cancelsOut(-250.006, 250)).toBe(false);
  });

  it("works just as well on the server's öre integers", () => {
    // Same function, both units: in öre anything unequal is off by at least 1,
    // which is far outside the tolerance.
    expect(cancelsOut(-25000, 25000)).toBe(true);
    expect(cancelsOut(-24999, 25000)).toBe(false);
  });
});
