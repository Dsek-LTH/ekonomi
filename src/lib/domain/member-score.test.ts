import { describe, expect, it } from "vitest";

import { memberScore, starsForDays, type ScoreCardPurchase, type ScoreExpense } from "./member-score";

const TODAY = "2026-10-28";

function day(daysAgo: number): string {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** Bought `daysAgo` days ago and sent `after` days later, or never. */
function sent(daysAgo: number, after: number | null, extra: Partial<ScoreExpense> = {}): ScoreExpense {
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

const score = (expenses: ScoreExpense[], cardPurchases: ScoreCardPurchase[] = []) =>
  memberScore({ today: TODAY, expenses, cardPurchases });

describe("starsForDays", () => {
  it("gives five within a week and one past the filing deadline", () => {
    expect(starsForDays(0)).toBe(5);
    expect(starsForDays(7)).toBe(5);
    expect(starsForDays(8)).toBe(4);
    expect(starsForDays(14)).toBe(4);
    expect(starsForDays(30)).toBe(3);
    expect(starsForDays(60)).toBe(2);
    expect(starsForDays(61)).toBe(1);
  });
});

describe("memberScore", () => {
  it("has no stars until there are three purchases to go on", () => {
    expect(score([sent(20, 1), sent(30, 2)]).stars).toBeNull();
    expect(score([sent(20, 1), sent(30, 2), sent(40, 1)]).stars).toBe(5);
  });

  it("is five for somebody who always sends within the week", () => {
    expect(score([sent(10, 1), sent(50, 3), sent(90, 7), sent(120, 0)]).stars).toBe(5);
  });

  it("is low for somebody who always sends late", () => {
    const s = score([sent(100, 45), sent(150, 70), sent(200, 90), sent(250, 40)]);
    expect(s.stars).toBeLessThanOrEqual(2.5);
  });

  it("counts a purchase not sent yet, by how long it has waited", () => {
    const prompt = [sent(30, 1), sent(60, 1), sent(90, 1)];
    const withOld = score([...prompt], [purchase(80)]);
    expect(withOld.stars).toBeLessThan(score(prompt).stars!);
    expect(withOld.waiting.map((i) => i.kind)).toEqual(["cardPurchase"]);
  });

  it("leaves a purchase alone while it is inside the week", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(3, null)], [purchase(5)]);
    expect(s.counted).toBe(3);
    expect(s.waiting).toEqual([]);
  });

  it("does not start the clock on a card purchase whose bank row is not in yet", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(40, null, { startedOn: null })]);
    expect(s.counted).toBe(3);
  });

  it("looks back a year and no further", () => {
    const s = score([sent(30, 1), sent(60, 1), sent(90, 1), sent(400, 90)]);
    expect(s.counted).toBe(3);
  });

  it("takes something off for being sent back, but not much", () => {
    const clean = [sent(30, 1), sent(60, 1), sent(90, 1), sent(120, 1)];
    const returned = clean.map((e) => ({ ...e, returned: true }));
    expect(score(clean).stars).toBe(5);
    expect(score(returned).stars).toBe(4.5);
    expect(score(returned).firstTime).toEqual({ clean: 0, of: 4 });
  });

  it("lists the slowest first", () => {
    const s = score([sent(30, 1), sent(60, 40), sent(90, 10)]);
    expect(s.items.map((i) => i.days)).toEqual([40, 10, 1]);
  });
});
