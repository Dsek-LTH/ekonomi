import { describe, expect, it } from "vitest";
import { bookedOver, freeOver, overlaps, shortfalls, type Booking } from "./availability";

// One Soundboks, four microphone stands. The shape of a real section's
// catalogue, and the two cases that behave differently: the thing there is one
// of, and the thing there are several of.
const OWNED = new Map([
  ["soundboks", 1],
  ["stativ", 4],
]);

const booking = (itemId: string, quantity: number, from: string, to: string): Booking => ({
  itemId,
  quantity,
  from,
  to,
});

describe("overlaps", () => {
  it("finds a plain overlap", () => {
    expect(
      overlaps({ from: "2026-08-31", to: "2026-09-02" }, { from: "2026-09-01", to: "2026-09-03" }),
    ).toBe(true);
  });

  it("leaves separated periods alone", () => {
    expect(
      overlaps({ from: "2026-08-01", to: "2026-08-02" }, { from: "2026-09-01", to: "2026-09-03" }),
    ).toBe(false);
  });

  it("treats a shared end day as a clash", () => {
    // Due back on the 5th and due out on the 5th. Conservative on purpose: the
    // two handovers may well fit, but nobody has said so, and a system that
    // assumes they do is volunteering an afternoon it knows nothing about.
    expect(
      overlaps({ from: "2026-09-01", to: "2026-09-05" }, { from: "2026-09-05", to: "2026-09-07" }),
    ).toBe(true);
  });

  it("catches a period wholly inside another", () => {
    expect(
      overlaps({ from: "2026-09-01", to: "2026-09-30" }, { from: "2026-09-10", to: "2026-09-11" }),
    ).toBe(true);
  });
});

describe("bookedOver", () => {
  it("adds quantities of the same item rather than counting contracts", () => {
    // Two contracts, two stands each. That is four stands out, not two
    // bookings, and only the first reading answers "is there one left".
    const taken = bookedOver(
      [
        booking("stativ", 2, "2026-09-01", "2026-09-03"),
        booking("stativ", 2, "2026-09-02", "2026-09-04"),
      ],
      { from: "2026-09-02", to: "2026-09-02" },
    );
    expect(taken.get("stativ")).toBe(4);
  });

  it("ignores bookings outside the period", () => {
    const taken = bookedOver([booking("soundboks", 1, "2026-08-01", "2026-08-02")], {
      from: "2026-09-01",
      to: "2026-09-02",
    });
    expect(taken.get("soundboks")).toBeUndefined();
  });
});

describe("shortfalls", () => {
  const period = { from: "2026-08-31", to: "2026-09-01" };

  it("passes a request the section can cover", () => {
    expect(
      shortfalls({
        requests: [{ itemId: "soundboks", quantity: 1 }],
        owned: OWNED,
        bookings: [],
        period,
      }),
    ).toEqual([]);
  });

  it("refuses the one Soundboks to a second contract over the same weekend", () => {
    // The case the whole module exists for.
    const out = shortfalls({
      requests: [{ itemId: "soundboks", quantity: 1 }],
      owned: OWNED,
      bookings: [booking("soundboks", 1, "2026-09-01", "2026-09-02")],
      period,
    });
    expect(out).toEqual([{ itemId: "soundboks", owned: 1, booked: 1, wanted: 1 }]);
  });

  it("allows the same item once the earlier rental is over", () => {
    expect(
      shortfalls({
        requests: [{ itemId: "soundboks", quantity: 1 }],
        owned: OWNED,
        bookings: [booking("soundboks", 1, "2026-07-01", "2026-07-02")],
        period,
      }),
    ).toEqual([]);
  });

  it("counts partial stock, so three of four stands still leaves one", () => {
    expect(
      shortfalls({
        requests: [{ itemId: "stativ", quantity: 1 }],
        owned: OWNED,
        bookings: [booking("stativ", 3, "2026-08-31", "2026-09-01")],
        period,
      }),
    ).toEqual([]);
  });

  it("refuses the fifth stand", () => {
    const out = shortfalls({
      requests: [{ itemId: "stativ", quantity: 2 }],
      owned: OWNED,
      bookings: [booking("stativ", 3, "2026-08-31", "2026-09-01")],
      period,
    });
    expect(out).toEqual([{ itemId: "stativ", owned: 4, booked: 3, wanted: 2 }]);
  });

  it("adds up the same item listed on two lines of one form", () => {
    // A form listing the Soundboks twice is asking for two of them, whatever
    // the person typing it thought.
    const out = shortfalls({
      requests: [
        { itemId: "soundboks", quantity: 1 },
        { itemId: "soundboks", quantity: 1 },
      ],
      owned: OWNED,
      bookings: [],
      period,
    });
    expect(out).toEqual([{ itemId: "soundboks", owned: 1, booked: 0, wanted: 2 }]);
  });

  it("says nothing about a line that is not a catalogue item", () => {
    // Free-text lines are allowed: somebody lends out a thing the catalogue has
    // never heard of, and refusing that would make the catalogue compulsory.
    expect(
      shortfalls({
        requests: [{ itemId: "en-sak-som-inte-finns", quantity: 3 }],
        owned: OWNED,
        bookings: [],
        period,
      }),
    ).toEqual([]);
  });
});

describe("freeOver", () => {
  it("reports what is left per item", () => {
    const free = freeOver({
      owned: OWNED,
      bookings: [
        booking("soundboks", 1, "2026-08-31", "2026-09-01"),
        booking("stativ", 1, "2026-08-31", "2026-09-01"),
      ],
      period: { from: "2026-08-31", to: "2026-09-01" },
    });
    expect(free.get("soundboks")).toBe(0);
    expect(free.get("stativ")).toBe(3);
  });

  it("floors an over-booked item at zero rather than reporting a negative", () => {
    // A quantity lowered after the contracts were drawn. "None free" is the
    // useful answer; "-2 free" is a puzzle.
    const free = freeOver({
      owned: new Map([["soundboks", 1]]),
      bookings: [
        booking("soundboks", 1, "2026-09-01", "2026-09-02"),
        booking("soundboks", 2, "2026-09-01", "2026-09-02"),
      ],
      period: { from: "2026-09-01", to: "2026-09-02" },
    });
    expect(free.get("soundboks")).toBe(0);
  });
});
