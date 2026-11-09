import { describe, expect, it } from "vitest";

import {
  attestPoints,
  attestsFromEvents,
  memberScore,
  submitPoints,
  type AttestEvent,
  type ScoreAttest,
  type ScoreCardPurchase,
  type ScoreExpense,
} from "./member-score";

const TODAY = "2026-10-28";

function day(daysAgo: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Bought `daysAgo` days ago and sent `after` days later, or never. */
function sent(
  daysAgo: number,
  after: number | null,
  extra: Partial<ScoreExpense> = {},
): ScoreExpense {
  return {
    id: `e${daysAgo}-${after}`,
    title: "Kvitto",
    paymentType: "REIMBURSEMENT",
    startedOn: day(daysAgo),
    submittedOn: after === null ? null : day(daysAgo - after),
    returned: false,
    judged: after !== null,
    ...extra,
  };
}

const purchase = (daysAgo: number): ScoreCardPurchase => ({
  id: `t${daysAgo}`,
  description: "ICA",
  amount: -10000,
  startedOn: day(daysAgo),
});

/** Reached the attester `daysAgo` days ago and signed `after` days later, or
 *  not yet. */
function attest(
  daysAgo: number,
  after: number | null,
  outcome: ScoreAttest["outcome"] = after === null ? "open" : "correct",
): ScoreAttest {
  return {
    record: "expense",
    id: `a${daysAgo}-${after}`,
    title: "Kvitto",
    readyOn: day(daysAgo),
    signedOn: after === null ? null : day(daysAgo - after),
    outcome,
  };
}

const score = (
  expenses: ScoreExpense[],
  cardPurchases: ScoreCardPurchase[] = [],
  attests: ScoreAttest[] = [],
) => memberScore({ today: TODAY, expenses, cardPurchases, attests });

describe("points", () => {
  it("gives full marks for submitting within a week and nothing past four months", () => {
    expect(submitPoints(0)).toBe(100);
    expect(submitPoints(7)).toBe(100);
    expect(submitPoints(14)).toBe(80);
    expect(submitPoints(22)).toBe(70);
    expect(submitPoints(60)).toBe(40);
    expect(submitPoints(120)).toBe(0);
    expect(submitPoints(400)).toBe(0);
  });

  it("gives full marks for attesting within three days and nothing past two months", () => {
    expect(attestPoints(3)).toBe(100);
    expect(attestPoints(7)).toBe(80);
    expect(attestPoints(30)).toBe(40);
    expect(attestPoints(60)).toBe(0);
  });
});

describe("memberScore", () => {
  it("has no score until some part has three things to go on", () => {
    expect(score([sent(20, 1), sent(30, 2)]).score).toBeNull();
    expect(score([sent(20, 1), sent(30, 2), sent(40, 1)]).score).not.toBeNull();
  });

  it("is high for somebody who always sends within the week and is never sent back", () => {
    const s = score([sent(10, 1), sent(50, 3), sent(90, 7), sent(120, 0)]);
    expect(s.parts.promptness.value).toBe(96);
    expect(s.parts.firstTime.value).toBe(100);
    expect(s.score).toBe(98);
  });

  it("is low for somebody who always sends late", () => {
    const s = score([sent(100, 75), sent(150, 90), sent(200, 100), sent(250, 80)]);
    expect(s.parts.promptness.value).toBeLessThan(40);
  });

  it("counts a purchase not sent yet, by how long it has waited", () => {
    const prompt = [sent(30, 1), sent(60, 1), sent(90, 1)];
    const withOld = score([...prompt], [purchase(80)]);
    expect(withOld.parts.promptness.value).toBeLessThan(score(prompt).parts.promptness.value!);
    expect(withOld.waiting.map((i) => i.kind)).toEqual(["cardPurchase"]);
  });

  it("leaves a purchase alone while it is inside the week", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(3, null)], [purchase(5)]);
    expect(s.parts.promptness.counted).toBe(3);
    expect(s.waiting).toEqual([]);
  });

  it("does not start the clock on a card purchase whose bank row is not in yet", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(40, null, { startedOn: null })]);
    expect(s.parts.promptness.counted).toBe(3);
  });

  it("looks back a year and no further", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(400, 90)]);
    expect(s.parts.promptness.counted).toBe(3);
  });

  it("scores going through first time as a share of its own", () => {
    const clean = [sent(30, 1), sent(60, 1), sent(90, 1), sent(120, 1)];
    const returned = clean.map((e) => ({ ...e, returned: true }));
    expect(score(returned).firstTime).toEqual({ clean: 0, of: 4 });
    // Two clean ones as a head start: 2 of 6.
    expect(score(returned).parts.firstTime.value).toBe(33);
  });

  it("leaves the attest parts out for somebody who does not attest", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1)]);
    expect(s.parts.attestAccuracy.value).toBeNull();
    expect(s.parts.attestSpeed.value).toBeNull();
    expect(s.score).toBe(Math.round((s.parts.promptness.value! + s.parts.firstTime.value!) / 2));
  });

  it("averages every part that has a value", () => {
    const s = score(
      [sent(30, 1), sent(60, 1), sent(90, 1)],
      [],
      [attest(10, 1), attest(20, 1), attest(30, 1, "returned")],
    );
    expect(s.accuracy).toEqual({ correct: 2, of: 3 });
    expect(s.parts.attestAccuracy.value).toBe(80);
    const values = Object.values(s.parts).map((p) => p.value!);
    expect(s.score).toBe(Math.round(values.reduce((a, b) => a + b) / 4));
    expect(s.returnedAttests.map((a) => a.id)).toEqual(["a30-1"]);
  });

  it("counts an attest waiting on the member, after three days", () => {
    const s = score(
      [],
      [],
      [attest(10, 1), attest(20, 1), attest(30, 1), attest(2, null), attest(40, null)],
    );
    expect(s.attestWaiting.map((i) => i.days)).toEqual([40]);
    expect(s.parts.attestSpeed.counted).toBe(4);
    // An open attest is not judged for accuracy.
    expect(s.accuracy.of).toBe(3);
  });

  it("lists the slowest first", () => {
    const s = score([sent(30, 1), sent(60, 40), sent(90, 10)]);
    expect(s.items.map((i) => i.days)).toEqual([40, 10, 1]);
  });
});

describe("attestsFromEvents", () => {
  const ev = (
    type: string,
    on: number,
    actorId: string | null = null,
    all = false,
  ): AttestEvent => ({
    type,
    actorId,
    on: day(on),
    all,
  });

  it("is correct once the utlägg is bokfört", () => {
    const a = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("COST_CENTER_APPROVED", 6, "bo"),
      ev("APPROVED", 6, "bo"),
      ev("BOOKED", 2),
    ]);
    expect(a).toEqual([
      { actorId: "anna", readyOn: day(10), signedOn: day(8), outcome: "correct" },
      { actorId: "bo", readyOn: day(10), signedOn: day(6), outcome: "correct" },
    ]);
  });

  it("is returned when the treasury sends back what was attested in full", () => {
    const a = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("APPROVED", 8, "anna"),
      ev("CHANGES_REQUESTED", 5, "kassor"),
      ev("SUBMITTED", 4),
      ev("COST_CENTER_APPROVED", 3, "anna"),
      ev("APPROVED", 3, "anna"),
      ev("BOOKED", 1),
    ]);
    expect(a.map((x) => [x.readyOn, x.outcome])).toEqual([
      [day(10), "returned"],
      [day(4), "correct"],
    ]);
  });

  it("is nobody's mistake when another attester sends it back, or it is recalled", () => {
    const a = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("CHANGES_REQUESTED", 7, "bo"),
      ev("SUBMITTED", 6),
      ev("COST_CENTER_APPROVED", 5, "anna"),
      ev("RECALLED", 4),
    ]);
    expect(a.map((x) => x.outcome)).toEqual(["open", "open"]);
  });

  it("is returned when the treasury corrects the date at the kontering", () => {
    const fault = { ...ev("CORRECTED", 2, "kassor"), faulted: true };
    // Written just before the BOOKED it rides with.
    const before = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("APPROVED", 8, "anna"),
      fault,
      ev("BOOKED", 2),
    ]);
    // Or on a later amend, after the round was settled.
    const after = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("COST_CENTER_APPROVED", 7, "bo"),
      ev("APPROVED", 7, "bo"),
      ev("BOOKED", 2),
      fault,
      fault,
    ]);
    expect(before.map((x) => x.outcome)).toEqual(["returned"]);
    expect(after.map((x) => x.outcome)).toEqual(["returned", "returned"]);
  });

  it("counts nobody's mistake for a correction that is not faulted", () => {
    const a = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("APPROVED", 8, "anna"),
      ev("CORRECTED", 3, "kassor"),
      ev("BOOKED", 2),
      ev("CORRECTED", 1, "kassor"),
    ]);
    expect(a.map((x) => x.outcome)).toEqual(["correct"]);
  });

  it("drops a signature its own attester took back", () => {
    const a = attestsFromEvents("expense", [
      ev("SUBMITTED", 10),
      ev("COST_CENTER_APPROVED", 8, "anna"),
      ev("ATTEST_WITHDRAWN", 7, "anna"),
    ]);
    expect(a).toEqual([]);
  });

  it("times a faktura's second unit from the first unit's signature", () => {
    const a = attestsFromEvents("invoice", [
      ev("ASSIGNED", 20),
      ev("COST_CENTER_APPROVED", 15, "anna"),
      ev("COST_CENTER_APPROVED", 12, "bo"),
      ev("APPROVED", 12, "bo"),
      ev("BOOKED", 10),
      ev("EXPORTED", 9),
    ]);
    expect(a.map((x) => [x.actorId, x.readyOn, x.outcome])).toEqual([
      ["anna", day(20), "correct"],
      ["bo", day(15), "correct"],
    ]);
  });

  it("counts a faktura sent back after it was konterad as returned", () => {
    const a = attestsFromEvents("invoice", [
      ev("ASSIGNED", 20),
      ev("COST_CENTER_APPROVED", 18, "anna"),
      ev("APPROVED", 18, "anna"),
      ev("BOOKED", 10),
      ev("CHANGES_REQUESTED", 9, "kassor"),
    ]);
    expect(a.map((x) => x.outcome)).toEqual(["returned"]);
  });
});
