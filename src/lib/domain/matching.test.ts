import { describe, expect, it } from "vitest";
import { cancelsOut, isMatchable, matchCandidates } from "./matching";

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
    // a list, and a refund can only settle a return.
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
// a bank row can settle for. An eget utlägg matched to one would have the
// section paying for the purchase twice.
describe("isMatchable", () => {
  it("lets a card purchase account for the row on the card", () => {
    expect(isMatchable("CARD")).toBe(true);
  });

  it("refuses an eget utlägg", () => {
    // The bug this exists to stop: "Redovisa" on a card purchase opened the
    // wizard with the transaction already matched, and switching the payment
    // type to "eget utlägg" kept the match, so the member was reimbursed for
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

describe("matchCandidates", () => {
  const txn = (id: string, amount: number, matchedExpenseId?: string) => ({
    id,
    amount,
    matchedExpenseId,
  });

  // A card statement with money going both ways.
  const rows = [
    txn("out-250", -250),
    txn("out-249", -249.5),
    txn("in-250", 250),
    txn("in-100", 100),
  ];

  it("offers outgoing rows for money the section spent", () => {
    const found = matchCandidates(rows, 250);
    expect(found.map((c) => c.txn.id)).toEqual(["out-250", "out-249"]);
    expect(found[0].selectable).toBe(true);
  });

  // The bug this exists for. A return is money coming back, so it is settled
  // by an *incoming* row. The wizard used to hand this the amount from the
  // form, which is a magnitude with the sign held on a separate toggle, so
  // `grossAmount < 0` was never true: a return offered the outgoing rows, and
  // the refund that would settle it was filtered out. Since a return is always
  // a card purchase, and a card purchase cannot be submitted unmatched, no
  // return could be completed at all.
  it("offers incoming rows for money coming back", () => {
    const found = matchCandidates(rows, -250);
    expect(found.map((c) => c.txn.id)).toEqual(["in-250", "in-100"]);
    expect(found[0].selectable).toBe(true);
  });

  it("never offers a row pointing the wrong way", () => {
    // Same size, wrong direction: it cannot settle this and must not be shown
    // as a near miss either, which would invite a click that does nothing.
    expect(matchCandidates(rows, 250).map((c) => c.txn.id)).not.toContain("in-250");
    expect(matchCandidates(rows, -250).map((c) => c.txn.id)).not.toContain("out-250");
  });

  it("keeps a near miss, and says it cannot be picked", () => {
    // An empty list would say "no card purchase looks like this"; the greyed
    // 249,50 says "one nearly does, check the amount you typed".
    const near = matchCandidates(rows, 249);
    expect(near.map((c) => c.txn.id)).toContain("out-249");
    expect(near.every((c) => c.selectable)).toBe(false);
  });

  it("puts the ones that would settle it first, then the closest", () => {
    const found = matchCandidates([txn("a", -100), txn("b", -260), txn("c", -250)], 250);
    expect(found.map((c) => c.txn.id)).toEqual(["c", "b", "a"]);
  });

  it("hides rows already spoken for, except this claim's own", () => {
    const taken = [txn("mine", -250, "e1"), txn("theirs", -250, "e2"), txn("free", -250)];
    expect(matchCandidates(taken, 250).map((c) => c.txn.id)).toEqual(["free"]);
    // Editing a claim: the row it already holds stays visible, so it can show
    // as picked rather than vanishing from under the selection. Named by the
    // transaction, which is what the screen is holding.
    expect(
      matchCandidates(taken, 250, "mine")
        .map((c) => c.txn.id)
        .sort(),
    ).toEqual(["free", "mine"]);
  });

  it("offers nothing while there is no amount to settle", () => {
    // Zero is not a direction. Every row would be a near miss, and a list of
    // the whole statement is no help before a figure has been typed.
    expect(matchCandidates(rows, 0).every((c) => !c.selectable)).toBe(true);
  });

  it("shows at most a handful", () => {
    const many = Array.from({ length: 20 }, (_, i) => txn(`t${i}`, -100 - i));
    expect(matchCandidates(many, 250)).toHaveLength(5);
  });
});
