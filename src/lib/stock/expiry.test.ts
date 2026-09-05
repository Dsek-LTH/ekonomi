import { describe, expect, it } from "vitest";
import {
  bestBeforeOf,
  checkOf,
  isDue,
  lastEmptied,
  soonestCheck,
  type Delivery,
  type ShelfStep,
} from "./expiry";

const NOW = "2026-09-02";
const LEAD = 30;

const delivery = (over: Partial<Delivery> = {}): Delivery => ({
  id: "e1",
  occurredAt: "2026-01-01",
  bestBefore: "2026-10-01",
  checkedAt: null,
  ...over,
});

describe("bestBeforeOf", () => {
  it("counts in whole months, which is how the answer is known", () => {
    // A lager: nine months. A cider: twenty-one.
    expect(bestBeforeOf("2026-03-12", 9)).toBe("2026-12-12");
    expect(bestBeforeOf("2026-03-12", 21)).toBe("2027-12-12");
  });

  it("clamps to a day the month has", () => {
    // Nine months from 31 May is not 31 February. Everybody means the last day
    // of the month it lands in, and Date's own arithmetic would roll it forward
    // into March instead.
    expect(bestBeforeOf("2026-05-31", 9)).toBe("2027-02-28");
    expect(bestBeforeOf("2026-08-31", 6)).toBe("2027-02-28");
  });

  it("says nothing about a product nobody has given a shelf life", () => {
    // Spirits, mostly. The gap shows as a gap rather than as a default nobody
    // believes, and a row with no date raises no checks at all.
    expect(bestBeforeOf("2026-03-12", null)).toBeNull();
    expect(bestBeforeOf("2026-03-12", undefined)).toBeNull();
    expect(bestBeforeOf("2026-03-12", 0)).toBeNull();
  });
});

describe("checkOf", () => {
  it("dates every delivery, and says which are owed", () => {
    // 1 October is 29 days off, so it is inside 30 and asks. 2 November is
    // still a check, and still listed on the product's page, but it is not
    // something to do this week.
    const soon = checkOf(delivery(), LEAD, null, NOW)!;
    expect(soon).toMatchObject({ state: "soon", daysLeft: 29 });
    expect(isDue(soon)).toBe(true);

    const later = checkOf(delivery({ bestBefore: "2026-11-02" }), LEAD, null, NOW)!;
    expect(later).toMatchObject({ state: "later", daysLeft: 61 });
    expect(isDue(later)).toBe(false);
  });

  it("keeps asking once the date is past", () => {
    const check = checkOf(delivery({ bestBefore: "2026-08-01" }), LEAD, null, NOW)!;
    expect(check).toMatchObject({ state: "over", daysLeft: -32 });
    expect(isDue(check)).toBe(true);
  });

  it("says nothing at all about something that does not go off", () => {
    expect(checkOf(delivery({ bestBefore: null }), LEAD, null, NOW)).toBeNull();
  });

  it("drops a delivery the shelf has been empty since", () => {
    // The rule that keeps the list clearable, and the one case where there is
    // nothing to list rather than something to dismiss: this beer was drunk,
    // and a page asking somebody to tick it off would be asking about stock
    // that left two years ago.
    expect(checkOf(delivery(), LEAD, "2026-02-01", NOW)).toBeNull();
    // Emptied *before* the delivery says nothing about it: the stock arrived
    // after the shelf was bare.
    expect(checkOf(delivery(), LEAD, "2025-12-31", NOW)).not.toBeNull();
    // The same day counts as gone. The delivery is walked to the end of its own
    // day, so a crate delivered and carried straight out is not still there.
    expect(checkOf(delivery(), LEAD, "2026-01-01", NOW)).toBeNull();
  });

  it("goes quiet for a lead time when somebody has looked at that delivery", () => {
    // Still a check, and still on the product's page saying when it was looked
    // at. It is simply not owed. And not silenced for good: a crate somebody
    // saw in July is still a crate, and comes back once the notice has run.
    const seen = checkOf(delivery({ checkedAt: "2026-08-20" }), LEAD, null, NOW)!;
    expect(seen).toMatchObject({ quiet: true, checkedAt: "2026-08-20" });
    expect(isDue(seen)).toBe(false);

    const stale = checkOf(delivery({ checkedAt: "2026-07-20" }), LEAD, null, NOW)!;
    expect(stale.quiet).toBe(false);
    expect(isDue(stale)).toBe(true);
  });
});

describe("soonestCheck", () => {
  it("shows the one at the back of the shelf", () => {
    const checks = [
      checkOf(delivery({ id: "a", bestBefore: "2026-09-20" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "b", bestBefore: "2026-08-01" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "c", bestBefore: "2026-09-10" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(checks)?.entryId).toBe("b");
  });

  it("passes over the ones that are not owed", () => {
    // The overview's flag has to mean "go and do something". A date in December
    // and a crate somebody read last week are both real checks and neither is
    // that, so a product carrying only those gets no flag at all.
    const checks = [
      checkOf(delivery({ id: "later", bestBefore: "2026-12-01" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "seen", checkedAt: "2026-08-25" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(checks)).toBeNull();

    // And the earliest date does not win when it is one of those: the oldest
    // *owed* one does.
    const mixed = [
      checkOf(delivery({ id: "seen", bestBefore: "2026-09-05", checkedAt: "2026-08-25" }), LEAD, null, NOW)!,
      checkOf(delivery({ id: "owed", bestBefore: "2026-09-25" }), LEAD, null, NOW)!,
    ];
    expect(soonestCheck(mixed)?.entryId).toBe("owed");
  });

  it("has no answer where nothing is due", () => {
    expect(soonestCheck([])).toBeNull();
  });
});

describe("lastEmptied", () => {
  const step = (occurredAt: string, units: number, openUnits = 0): ShelfStep => ({
    occurredAt,
    units,
    openUnits,
  });

  it("finds the last day nothing was on the shelf", () => {
    expect(
      lastEmptied([
        step("2026-01-01", 24),
        step("2026-02-01", -24),
        step("2026-03-01", 24),
        step("2026-04-01", -12),
      ]),
    ).toBe("2026-02-01");
  });

  it("reads the day at its end, not row by row", () => {
    // A delivery and the checkout against it share a date as often as not, and
    // are written in whichever order somebody got to them. Read row by row, the
    // second of these dips to −12 before the crate arrives and the day looks
    // like it emptied. Only the state the day closed at is one anybody in the
    // cellar would recognise, and it has to be the same either way round.
    expect(lastEmptied([step("2026-02-01", 24), step("2026-02-01", -12)])).toBeNull();
    expect(lastEmptied([step("2026-02-01", -12), step("2026-02-01", 24)])).toBeNull();

    // And when the day really does close at nothing, the order still does not
    // matter.
    expect(lastEmptied([step("2026-02-01", 24), step("2026-02-01", -24)])).toBe("2026-02-01");
    expect(lastEmptied([step("2026-02-01", -24), step("2026-02-01", 24)])).toBe("2026-02-01");
  });

  it("counts open bottles as stock", () => {
    // The sealed count reaching nothing is not an empty shelf while a bottle
    // stands open beside it.
    expect(lastEmptied([step("2026-01-01", 1), step("2026-02-01", -1, 1)])).toBeNull();
  });

  it("has no answer for a product that has never run out", () => {
    expect(lastEmptied([step("2026-01-01", 24), step("2026-02-01", -12)])).toBeNull();
    expect(lastEmptied([])).toBeNull();
  });

  it("treats a log that has gone negative as empty", () => {
    // Negative stock is a bookkeeping fault rather than a fact, said on the
    // same screen by `impossible`. Either way there is nothing down there.
    expect(lastEmptied([step("2026-01-01", 24), step("2026-02-01", -30)])).toBe("2026-02-01");
  });

  // ── Starting part-way through the log ────────────────────────────
  //
  // The loaders do not fetch every movement a product has ever made; they cut
  // the log at the oldest delivery being asked about and sum what came before
  // into one opening balance (see `getExpiryChecks`). These pin that the cut
  // cannot change the answer.
  describe("with an opening balance", () => {
    const whole = [
      step("2026-01-01", 24),
      step("2026-02-01", -24),
      step("2026-03-01", 24),
      step("2026-04-01", -12),
    ];

    it("answers the same as the whole log when the empty day is inside the window", () => {
      // Cut after the first delivery: 24 on the shelf, and February still
      // empties it.
      expect(lastEmptied(whole)).toBe("2026-02-01");
      expect(lastEmptied(whole.slice(1), 24)).toBe("2026-02-01");
    });

    it("reports nothing when the shelf only emptied before the window", () => {
      // Cut after February. Nothing inside the window empties the shelf, and
      // the empty day before it is out of reach, which is exactly the case
      // `checkOf` cannot be affected by: no delivery in the window is older
      // than it.
      expect(lastEmptied(whole.slice(2), 0)).toBeNull();
    });

    it("carries the opening balance into the first day", () => {
      // The opening stock is what the first step in the window works against:
      // taking 24 out of an empty window is only an empty shelf if there were
      // 24 there to start with.
      expect(lastEmptied([step("2026-05-01", -24)], 24)).toBe("2026-05-01");
      expect(lastEmptied([step("2026-05-01", -24)], 36)).toBeNull();
    });

    it("defaults to nothing on the shelf, which is the whole-log case", () => {
      expect(lastEmptied(whole, 0)).toBe(lastEmptied(whole));
    });
  });
});
