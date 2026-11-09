import { describe, expect, it } from "vitest";
import { cancelsOut, isMatchable, matchCandidates } from "./matching";

// A bank transaction settles an utlägg only when the two cancel exactly (+250 on the utlägg, -250 in the bank).
describe("cancelsOut", () => {
  it("matches a purchase against the money leaving the account", () => {
    expect(cancelsOut(-250, 250)).toBe(true);
  });

  it("matches a return against the money coming back", () => {
    expect(cancelsOut(250, -250)).toBe(true);
  });

  it("refuses a row of the right size in the wrong direction", () => {
    // Two outgoing amounts do not settle each other, and a refund can only settle a return.
    expect(cancelsOut(-250, -250)).toBe(false);
    expect(cancelsOut(250, 250)).toBe(false);
  });

  it("refuses a near miss", () => {
    // A mistyped amount (249,50 against 250 kr) stays unselectable: that tells the submitter the amount is wrong.
    expect(cancelsOut(-249.5, 250)).toBe(false);
    expect(cancelsOut(-250.01, 250)).toBe(false);
  });

  it("has nothing to settle against a zero amount", () => {
    // A draft with no amount would otherwise match every zero-sum pairing.
    expect(cancelsOut(0, 0)).toBe(false);
    expect(cancelsOut(-250, 0)).toBe(false);
  });

  it("absorbs float noise from the client's SEK arithmetic", () => {
    expect(cancelsOut(-250.004, 250)).toBe(true);
    expect(cancelsOut(-250.006, 250)).toBe(false);
  });

  it("works just as well on the server's öre integers", () => {
    // Same function, both units: in öre anything unequal is off by at least 1.
    expect(cancelsOut(-25000, 25000)).toBe(true);
    expect(cancelsOut(-24999, 25000)).toBe(false);
  });
});

// Only the section's card can be settled by a bank row; an eget utlägg matched to one would be paid twice.
describe("isMatchable", () => {
  it("lets a card purchase account for the row on the card", () => {
    expect(isMatchable("CARD")).toBe(true);
  });

  it("refuses an eget utlägg", () => {
    // Switching the payment type away from the card must not keep the match.
    expect(isMatchable("REIMBURSEMENT")).toBe(false);
  });

  it("refuses anything it does not recognise", () => {
    // The routes hand it whatever is stored on the row: a new payment type is not matchable until this says so.
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

  const rows = [
    txn("out-250", -250),
    txn("out-249", -249.5),
    txn("in-250", 250),
    txn("in-100", 100),
  ];

  type Candidates = ReturnType<typeof matchCandidates<ReturnType<typeof txn>>>;
  const idsOf = (cs: Candidates) => cs.map((c) => c.txn.id);
  const find = (cs: Candidates, id: string) => cs.find((c) => c.txn.id === id)!;

  it("settles money the section spent with an outgoing row", () => {
    const found = matchCandidates(rows, 250);
    expect(found[0].txn.id).toBe("out-250");
    expect(found[0].selectable).toBe(true);
    expect(found[0].blocked).toBeNull();
  });

  // A return is settled by an incoming row. The wizard's form holds a magnitude with the sign on a toggle, so `grossAmount < 0` was never true.
  it("settles money coming back with an incoming row", () => {
    const found = matchCandidates(rows, -250);
    expect(found[0].txn.id).toBe("in-250");
    expect(found[0].selectable).toBe(true);
  });

  it("keeps a row pointing the wrong way, and names the direction", () => {
    // Same size, other way round: told apart from a wrong amount, since the figure is not wrong.
    const wrong = find(matchCandidates(rows, 250), "in-250");
    expect(wrong.selectable).toBe(false);
    expect(wrong.blocked).toBe("direction");
  });

  it("keeps a near miss, and says how far off it is", () => {
    // A greyed 249,50 with "0,50 kr mindre" says which digit was mistyped.
    const near = find(matchCandidates(rows, 250), "out-249");
    expect(near.blocked).toBe("amount");
    expect(near.offBy).toBe(-0.5);
  });

  it("measures offBy as magnitudes, whichever way the claim points", () => {
    // A return of 250 against an incoming 260 is 10 kr over, like a purchase against an outgoing 260.
    expect(find(matchCandidates([txn("a", -260)], 250), "a").offBy).toBe(10);
    expect(find(matchCandidates([txn("a", 260)], -250), "a").offBy).toBe(10);
  });

  it("puts the ones that would settle it first, then the closest", () => {
    expect(idsOf(matchCandidates([txn("a", -100), txn("b", -260), txn("c", -250)], 250))).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("keeps a row another utlägg claims, and says so", () => {
    // Claimed by another utlägg: sits directly under the rows that work, since it is the answer to "where is it?".
    const taken = [txn("theirs", -250, "e2"), txn("free", -250)];
    const found = matchCandidates(taken, 250);
    expect(find(found, "theirs").blocked).toBe("taken");
    expect(find(found, "theirs").selectable).toBe(false);
    expect(find(found, "free").selectable).toBe(true);
    expect(idsOf(found)[0]).toBe("free");
  });

  it("counts this claim's own row as free rather than taken", () => {
    // Editing a claim: the row it already holds must read as pickable.
    const taken = [txn("mine", -250, "e1"), txn("free", -250)];
    expect(find(matchCandidates(taken, 250, "mine"), "mine").selectable).toBe(true);
  });

  it("reports a claimed row as taken whatever its amount", () => {
    expect(find(matchCandidates([txn("t", -300, "e2")], 250), "t").blocked).toBe("taken");
    expect(find(matchCandidates([txn("t", 300, "e2")], 250), "t").blocked).toBe("taken");
  });

  it("settles nothing while there is no amount to settle", () => {
    expect(matchCandidates(rows, 0).every((c) => !c.selectable)).toBe(true);
  });

  it("returns the whole statement, not a handful of it", () => {
    // Nothing is capped: a sixth-closest row must still be listed.
    const many = Array.from({ length: 20 }, (_, i) => txn(`t${i}`, -100 - i));
    expect(matchCandidates(many, 250)).toHaveLength(20);
  });

  it("orders two rows of the same size the same way twice", () => {
    // Stable order between renders.
    const same = [txn("b", -250), txn("a", -250)];
    expect(idsOf(matchCandidates(same, 250))).toEqual(idsOf(matchCandidates(same, 250)));
  });
});

describe("matchCandidates, by the day", () => {
  const txn = (id: string, amount: number, transactionDate: string, matchedExpenseId?: string) => ({
    id,
    amount,
    transactionDate,
    matchedExpenseId,
  });
  const ids = (cs: { txn: { id: string } }[]) => cs.map((c) => c.txn.id);

  it("puts a near day ahead of a near amount among the rows that cannot be picked", () => {
    const rows = [txn("last-month", -251, "2026-09-12"), txn("same-day", -253, "2026-10-12")];
    expect(ids(matchCandidates(rows, 250, null, "2026-10-12"))).toEqual(["same-day", "last-month"]);
  });

  it("still ranks by amount when there is no purchase date", () => {
    const rows = [txn("last-month", -251, "2026-09-12"), txn("same-day", -253, "2026-10-12")];
    expect(ids(matchCandidates(rows, 250))).toEqual(["last-month", "same-day"]);
  });

  it("keeps the rows that can be picked first, whatever their day", () => {
    const rows = [txn("near-wrong", -253, "2026-10-12"), txn("far-right", -250, "2026-09-01")];
    expect(ids(matchCandidates(rows, 250, null, "2026-10-12"))).toEqual([
      "far-right",
      "near-wrong",
    ]);
  });

  it("takes a free row a few days off with another amount for a typo", () => {
    const found = matchCandidates(
      [
        txn("typo", -253, "2026-10-14"),
        txn("too-far", -253, "2026-10-20"),
        txn("claimed", -253, "2026-10-12", "e9"),
        txn("refund", 253, "2026-10-12"),
      ],
      250,
      null,
      "2026-10-12",
    );
    const fixable = Object.fromEntries(found.map((c) => [c.txn.id, c.fixable]));
    expect(fixable).toEqual({ typo: true, "too-far": false, claimed: false, refund: false });
    expect(found.find((c) => c.txn.id === "typo")!.daysOff).toBe(2);
  });
});
