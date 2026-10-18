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

  type Candidates = ReturnType<typeof matchCandidates<ReturnType<typeof txn>>>;
  const idsOf = (cs: Candidates) => cs.map((c) => c.txn.id);
  const find = (cs: Candidates, id: string) => cs.find((c) => c.txn.id === id)!;

  it("settles money the section spent with an outgoing row", () => {
    const found = matchCandidates(rows, 250);
    expect(found[0].txn.id).toBe("out-250");
    expect(found[0].selectable).toBe(true);
    expect(found[0].blocked).toBeNull();
  });

  // The bug this exists for. A return is money coming back, so it is settled
  // by an *incoming* row. The wizard used to hand this the amount from the
  // form, which is a magnitude with the sign held on a separate toggle, so
  // `grossAmount < 0` was never true: a return offered the outgoing rows, and
  // the refund that would settle it was filtered out. Since a return is always
  // a card purchase, and a card purchase cannot be submitted unmatched, no
  // return could be completed at all.
  it("settles money coming back with an incoming row", () => {
    const found = matchCandidates(rows, -250);
    expect(found[0].txn.id).toBe("in-250");
    expect(found[0].selectable).toBe(true);
  });

  it("keeps a row pointing the wrong way, and names the direction", () => {
    // Same size, other way round. It used to be dropped, which made a +250 row
    // invisible to a +250 claim and left "the purchase is right there and it is
    // not in the list" with no answer at all. Told apart from a wrong amount on
    // purpose: the figure is identical, so "annat belopp" would send somebody
    // off to check a number that was never wrong.
    const wrong = find(matchCandidates(rows, 250), "in-250");
    expect(wrong.selectable).toBe(false);
    expect(wrong.blocked).toBe("direction");
  });

  it("keeps a near miss, and says how far off it is", () => {
    // An empty list would say "no card purchase looks like this"; the greyed
    // 249,50 with "0,50 kr mindre" on it says which digit was mistyped.
    const near = find(matchCandidates(rows, 250), "out-249");
    expect(near.blocked).toBe("amount");
    expect(near.offBy).toBe(-0.5);
  });

  it("measures offBy as magnitudes, whichever way the claim points", () => {
    // A return of 250 against an incoming 260 is 10 kr over, the same as a
    // purchase of 250 against an outgoing 260. The reader is asking how far off
    // the row is, not which way the two are signed.
    expect(find(matchCandidates([txn("a", -260)], 250), "a").offBy).toBe(10);
    expect(find(matchCandidates([txn("a", 260)], -250), "a").offBy).toBe(10);
  });

  it("puts the ones that would settle it first, then the closest", () => {
    expect(idsOf(matchCandidates([txn("a", -100), txn("b", -260), txn("c", -250)], 250)))
      .toEqual(["c", "b", "a"]);
  });

  it("keeps a row another utlägg claims, and says so", () => {
    // The one that used to be silent. Somebody else redovisade your purchase
    // and the row was simply gone, so the answer to "where is it?" was a hint
    // guessing at an unimported bank file. It now sits directly under the rows
    // that work, because it is the answer.
    const taken = [txn("theirs", -250, "e2"), txn("free", -250)];
    const found = matchCandidates(taken, 250);
    expect(find(found, "theirs").blocked).toBe("taken");
    expect(find(found, "theirs").selectable).toBe(false);
    expect(find(found, "free").selectable).toBe(true);
    expect(idsOf(found)[0]).toBe("free");
  });

  it("counts this claim's own row as free rather than taken", () => {
    // Editing a claim: the row it already holds has to read as pickable, or the
    // selection it is showing would be greyed out under the cursor.
    const taken = [txn("mine", -250, "e1"), txn("free", -250)];
    expect(find(matchCandidates(taken, 250, "mine"), "mine").selectable).toBe(true);
  });

  it("reports a wrong amount even on a row somebody else has claimed", () => {
    // Both are true, and only one is worth saying. "Redan redovisad" about a
    // row that would not have fitted anyway sends the reader after the wrong
    // thing entirely.
    expect(find(matchCandidates([txn("t", -300, "e2")], 250), "t").blocked).toBe("amount");
  });

  it("settles nothing while there is no amount to settle", () => {
    // Zero is not a direction, and nothing cancels it out.
    expect(matchCandidates(rows, 0).every((c) => !c.selectable)).toBe(true);
  });

  it("returns the whole statement, not a handful of it", () => {
    // The cap was five, silently. A transaction that happened to be sixth
    // closest was missing with nothing to say it existed; the screens search
    // and scroll instead.
    const many = Array.from({ length: 20 }, (_, i) => txn(`t${i}`, -100 - i));
    expect(matchCandidates(many, 250)).toHaveLength(20);
  });

  it("orders two rows of the same size the same way twice", () => {
    // Otherwise a list re-sorts under the pointer between renders.
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
    expect(ids(matchCandidates(rows, 250, null, "2026-10-12"))).toEqual(["far-right", "near-wrong"]);
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
