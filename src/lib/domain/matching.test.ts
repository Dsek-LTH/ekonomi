import { describe, expect, it } from "vitest";
import { cancelsOut, isMatchable } from "./matching";

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

// Who is allowed to hold a match at all. The section's card is the only payer
// a bank row can settle for — an eget utlägg matched to one would have the
// section paying for the purchase twice.
describe("isMatchable", () => {
  it("lets a card purchase account for the row on the card", () => {
    expect(isMatchable("CARD")).toBe(true);
  });

  it("refuses an eget utlägg", () => {
    // The bug this exists to stop: "Redovisa" on a card purchase opened the
    // wizard with the transaction already matched, and switching the payment
    // type to "eget utlägg" kept the match — so the member was reimbursed for
    // money that had already left the section's card, and the purchase counted
    // as accounted for on the way out.
    expect(isMatchable("REIMBURSEMENT")).toBe(false);
  });

  it("refuses anything it does not recognise", () => {
    // The routes hand it whatever is stored on the row. A payment type added
    // later is not matchable until this says it is.
    expect(isMatchable("")).toBe(false);
    expect(isMatchable("card")).toBe(false);
  });
});
