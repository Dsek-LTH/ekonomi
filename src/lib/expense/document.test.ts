import { describe, expect, it } from "vitest";

import { buildCoverData, coverFilename } from "./document";

// The wording decisions, asserted without a typesetter (see cover/types.ts).

const TODAY = new Date("2026-08-14T09:30:00Z");

const base = {
  reference: "DEK26-0042",
  title: "FREETRAILER: Hyrning",
  purchaseDate: new Date("2026-03-19T00:00:00Z"),
  paymentType: "REIMBURSEMENT",
  grossAmount: 6900,
  odometerStart: null,
  odometerEnd: null,
  journeyStops: [],
  mileageOrePerKm: null,
  deadlineWaivedAt: null,
  deadlineWaiverReason: null,
  deadlineWaivedBy: null,
  submitter: { name: "Emil Helander", studentId: "em8241he-s" },
  allocations: [
    {
      amount: 6900,
      comment: null,
      approvedAt: new Date("2026-04-02T11:00:00Z"),
      costCenter: { code: "SEKT05", name: "Sexmästeriet" },
      approvedBy: { name: "Ludwig Gehlsdorf" },
    },
  ],
};

describe("buildCoverData", () => {
  it("states who konterade it, and anyone who amended it since", () => {
    expect(buildCoverData(base, TODAY).booking).toBeNull();
    const booking = {
      by: "Anna Andersson",
      at: new Date("2026-04-03T10:00:00Z"),
      amendedBy: ["Bo Berg", "Cia Ceder"],
    };
    expect(buildCoverData({ ...base, booking }, TODAY).booking).toEqual({
      by: "Anna Andersson",
      at: "2026-04-03",
      amendedBy: "Bo Berg och Cia Ceder",
    });
    expect(
      buildCoverData({ ...base, booking: { ...booking, amendedBy: [] } }, TODAY).booking?.amendedBy,
    ).toBeNull();
  });

  it("states the utlägg in Swedish, formatted and ready to place", () => {
    const d = buildCoverData(base, TODAY);
    expect(d.reference).toBe("DEK26-0042");
    expect(d.paymentType).toBe("Privat utlägg");
    expect(d.purchaseDate).toBe("2026-03-19");
    expect(d.created).toBe("2026-08-14");
    expect(d.submitter).toEqual({ name: "Emil Helander", studentId: "em8241he-s" });
  });

  it("words a section card differently from an out-of-pocket utlägg", () => {
    expect(buildCoverData({ ...base, paymentType: "CARD" }, TODAY).paymentType).toBe(
      "Sektionskort",
    );
    expect(buildCoverData({ ...base, paymentType: "MILEAGE" }, TODAY).paymentType).toBe(
      "Milersättning",
    );
  });

  it("names the date for what it is on each kind of utlägg", () => {
    // A milersättning has no receipt, so "Kvittodatum" would name a document that does not exist.
    expect(buildCoverData(base, TODAY).dateLabel).toBe("Kvittodatum");
    expect(buildCoverData({ ...base, paymentType: "MILEAGE" }, TODAY).dateLabel).toBe("Resdag");
  });

  it("formats amounts as Swedish kronor, thousands separated", () => {
    const d = buildCoverData(
      { ...base, allocations: [{ ...base.allocations[0], amount: 106900 }] },
      TODAY,
    );
    // sv-SE groups with a non-breaking space, and "1 069,00 kr" must never break across a line.
    expect(d.total.replace(/ /g, " ")).toBe("1 069,00 kr");
    expect(d.allocations[0].amount.replace(/ /g, " ")).toBe("1 069,00 kr");
  });

  it("names each cost centre by its code alone", () => {
    expect(buildCoverData(base, TODAY).allocations[0].costCenter).toBe("SEKT05");
  });

  it("totals the allocations rather than the recorded gross", () => {
    // Attestation is per allocation, so a disagreeing grossAmount does not decide.
    const d = buildCoverData(
      {
        ...base,
        grossAmount: 999999,
        allocations: [
          { ...base.allocations[0], amount: 2500 },
          { ...base.allocations[0], amount: 1500 },
        ],
      },
      TODAY,
    );
    expect(d.total.replace(/ /g, " ")).toBe("40,00 kr");
  });

  it("leaves an unattested slice null rather than inventing a placeholder", () => {
    const d = buildCoverData(
      {
        ...base,
        allocations: [{ ...base.allocations[0], approvedBy: null, approvedAt: null }],
      },
      TODAY,
    );
    expect(d.allocations[0].approvedBy).toBeNull();
    expect(d.allocations[0].approvedAt).toBeNull();
  });

  it("survives an utlägg with no reference, purchase date or StiL-ID", () => {
    const d = buildCoverData(
      {
        ...base,
        reference: null,
        purchaseDate: null,
        submitter: { name: "Anon", studentId: null },
      },
      TODAY,
    );
    expect(d.reference).toBe("-");
    expect(d.purchaseDate).toBeNull();
    expect(d.submitter.studentId).toBeNull();
  });
});

describe("buildCoverData, the dispens", () => {
  // A late utlägg the skattmästare took anyway: the page is the only place the decision is written beside the voucher. See ExpenseCoverWaiver.
  const waived = {
    ...base,
    // 19 March, granted on 3 June: 76 days, well past the 60-day frist.
    deadlineWaivedAt: new Date("2026-06-03T13:20:00Z"),
    deadlineWaiverReason: "Kvittot kom bort i flytten och har eftersökts sedan i maj.",
    deadlineWaivedBy: { name: "Nora Lindqvist" },
  };

  it("is absent from an utlägg that was in time", () => {
    expect(buildCoverData(base, TODAY).waiver).toBeNull();
  });

  it("names who allowed it, when, and in whose words", () => {
    const w = buildCoverData(waived, TODAY).waiver!;
    expect(w.by).toBe("Nora Lindqvist");
    expect(w.at).toBe("2026-06-03");
    expect(w.reason).toBe("Kvittot kom bort i flytten och har eftersökts sedan i maj.");
  });

  it("counts the lateness to the day of the dispens, not to today", () => {
    // The second is drawn months later: a document filed beside a voucher must not change.
    expect(buildCoverData(waived, TODAY).waiver!.lateness).toBe("76 dagar efter köpet");
    expect(buildCoverData(waived, new Date("2027-01-01T00:00:00Z")).waiver!.lateness).toBe(
      "76 dagar efter köpet",
    );
  });

  it("says resan rather than köpet on a milersättning", () => {
    expect(buildCoverData({ ...waived, paymentType: "MILEAGE" }, TODAY).waiver!.lateness).toBe(
      "76 dagar efter resan",
    );
  });

  it("needs both the day and the reason before it states one at all", () => {
    // The route writes and clears the three columns together, so a half-set dispens reads as absent.
    expect(buildCoverData({ ...waived, deadlineWaiverReason: null }, TODAY).waiver).toBeNull();
    expect(buildCoverData({ ...waived, deadlineWaivedAt: null }, TODAY).waiver).toBeNull();
  });
});

// Swedish groups thousands with a non-breaking space, which an assertion with an ordinary space would silently fail on.
const NB = "\u00a0";

type ForCover = Parameters<typeof buildCoverData>[0];

const mileage = (over: Partial<ForCover> = {}): ForCover => ({
  ...base,
  paymentType: "MILEAGE",
  title: "Hämta sponsorpaket",
  odometerStart: 12300,
  odometerEnd: 12342,
  journeyStops: ["Kårhuset, Lund", "Snabbgross", "Kårhuset, Lund"],
  mileageOrePerKm: 250,
  ...over,
});

describe("buildCoverData, the journey", () => {
  it("is absent from an utlägg that rests on a receipt", () => {
    expect(buildCoverData(base, TODAY).journey).toBeNull();
    expect(buildCoverData({ ...base, paymentType: "CARD" }, TODAY).journey).toBeNull();
  });

  it("states the journey the way a körjournal would", () => {
    const j = buildCoverData(mileage(), TODAY).journey!;
    expect(j.route).toBe("Kårhuset, Lund → Snabbgross → Kårhuset, Lund");
    expect(j.odometerStart).toBe(`12${NB}300,0 km`);
    expect(j.odometerEnd).toBe(`12${NB}342,0 km`);
    expect(j.distance).toBe("42,0 km");
    expect(j.rate).toBe("2,50 kr/km");
  });

  it("keeps every stop, not just the ends", () => {
    // The errand that called at two places: printing only the ends would drop the reason for the distance.
    const j = buildCoverData(
      mileage({ journeyStops: ["E-huset", "Snabbgross", "Systembolaget", "Hem"] }),
      TODAY,
    ).journey!;
    expect(j.route).toBe("E-huset → Snabbgross → Systembolaget → Hem");
  });

  it("says nothing rather than drawing arrows between blanks", () => {
    // A draft with rows still empty: "-" is the honest word for a route nobody has given.
    expect(buildCoverData(mileage({ journeyStops: [] }), TODAY).journey!.route).toBe("-");
    expect(
      buildCoverData(mileage({ journeyStops: ["E-huset", "  ", ""] }), TODAY).journey!.route,
    ).toBe("E-huset");
  });

  it("writes the readings and the difference to the same precision", () => {
    // Readings and difference share one precision, so the subtraction can be done by eye.
    const j = buildCoverData(
      mileage({ odometerStart: 12300.1, odometerEnd: 12345.6 }),
      TODAY,
    ).journey!;
    expect([j.odometerStart, j.odometerEnd, j.distance]).toEqual([
      `12${NB}300,1 km`,
      `12${NB}345,6 km`,
      "45,5 km",
    ]);
  });

  it("says a dash for a reading nobody has given yet", () => {
    const j = buildCoverData(mileage({ odometerEnd: null }), TODAY).journey!;
    expect(j.odometerEnd).toBe("-");
    expect(j.distance).toBe("-");
  });

  it("says a dash for a journey no rate covered", () => {
    expect(buildCoverData(mileage({ mileageOrePerKm: null }), TODAY).journey!.rate).toBe("-");
  });
});

describe("coverFilename", () => {
  it("names the file after the reference, falling back to the id", () => {
    expect(coverFilename("DEK26-0042", "cuid1")).toBe("utlaggsrakning-DEK26-0042.pdf");
    expect(coverFilename(null, "cuid1")).toBe("utlaggsrakning-cuid1.pdf");
  });
});
