import { describe, expect, it } from "vitest";
import { buildRentalData, type ContractForDocument } from "./document";
import { TERMS_VERSION } from "./rental/terms";

// What the document *says*, asserted without going near a typesetter. Whether
// the template still compiles is rental/typst.test.ts's question; this one is
// about the wording and the arithmetic, which is where the decisions are.

const LESSOR = {
  name: "D-sektionen inom TLTH",
  orgNo: "845001-1234",
  address: "Ole Römers väg 3",
  postalLine: "223 63 Lund",
};

const contract: ContractForDocument = {
  title: "Uthyrning av ljudanläggning",
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  counterpartyAddress: "Ole Römers väg 3",
  counterpartyPostalCode: "223 63",
  counterpartyCity: "Lund",
  createdAt: new Date("2026-09-06T14:12:00.000Z"),
  rental: {
    pickupAt: new Date("2026-09-18T00:00:00.000Z"),
    returnAt: new Date("2026-09-21T00:00:00.000Z"),
    purpose: "Sittning i iDét",
    place: "Kårhuset, Lund",
    paymentDueAt: new Date("2026-09-15T00:00:00.000Z"),
    lines: [
      {
        description: "Högtalare, aktiv 12 tum",
        quantity: 2,
        unitPriceOre: 25_000,
        discountPercent: 0,
        replacementValueOre: 650_000,
      },
      {
        description: "Mixerbord 8 kanaler",
        quantity: 1,
        unitPriceOre: 15_000,
        discountPercent: 0,
        replacementValueOre: 420_000,
      },
    ],
  },
  parties: [
    {
      role: "SECTION",
      name: "Ludwig Gehlsdorf",
      title: "Skattmästare",
      orgName: null,
      orgNo: null,
      email: null,
      phone: null,
    },
    {
      role: "COUNTERPARTY",
      name: "Emil Helander",
      title: "Ordförande F-sektionen",
      orgName: "F-sektionen inom TLTH",
      orgNo: "845002-5678",
      email: "ordf@fsektionen.se",
      phone: null,
    },
  ],
};

describe("buildRentalData", () => {
  it("writes money the way the rest of the app writes it in Swedish", () => {
    const d = buildRentalData(contract, LESSOR);
    // A non-breaking space as the group separator, which is what sv-SE uses.
    expect(d.subtotal).toBe("650,00 kr");
    expect(d.price).toBe("650,00 kr");
    expect(d.lines[0].unitPrice).toBe("250,00 kr");
  });

  it("charges the lines when nothing is discounted, and says so by omission", () => {
    // Null rather than "0,00 kr": the template leaves the row and the whole
    // column out, because a document stating a discount of nothing invites the
    // wrong question.
    const d = buildRentalData(contract, LESSOR);
    expect(d.discount).toBeNull();
    expect(d.anyDiscount).toBe(false);
    expect(d.lines.every((l) => l.discount === null)).toBe(true);
  });

  it("takes each line's own discount off to get the rent", () => {
    // The mixer at full price, the speakers at 30 per cent off: 500 less 150.
    const d = buildRentalData(
      {
        ...contract,
        rental: {
          ...contract.rental,
          lines: contract.rental.lines.map((l, i) =>
            i === 0 ? { ...l, discountPercent: 30 } : l,
          ),
        },
      },
      LESSOR,
    );
    expect(d.subtotal).toBe("650,00 kr");
    expect(d.discount).toBe("150,00 kr");
    expect(d.price).toBe("500,00 kr");
    // Stated on the line it came off, which is the point of moving it there.
    expect(d.lines[0].discount).toBe("30 %");
    expect(d.lines[0].lineTotal).toBe("350,00 kr");
    expect(d.lines[1].discount).toBeNull();
    expect(d.anyDiscount).toBe(true);
  });

  it("lends for nothing when every line is fully discounted", () => {
    // Lending to another section for nothing is a real and common case. It used
    // to be a 0 typed over a column of real prices, recording the intent
    // nowhere; now every line stands at its price and comes off in full.
    const free = buildRentalData(
      {
        ...contract,
        rental: {
          ...contract.rental,
          lines: contract.rental.lines.map((l) => ({ ...l, discountPercent: 100 })),
        },
      },
      LESSOR,
    );
    expect(free.subtotal).toBe("650,00 kr");
    expect(free.discount).toBe("650,00 kr");
    expect(free.price).toBe("0,00 kr");
  });

  it("sets the renter's postal line the way an address is written", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.counterpartyAddress).toBe("Ole Römers väg 3");
    expect(d.counterpartyPostalLine).toBe("223 63 Lund");
  });

  it("still prints half an address, which is more use than none", () => {
    // A contract drawn before the form asked for either half.
    const half = buildRentalData({ ...contract, counterpartyPostalCode: null }, LESSOR);
    expect(half.counterpartyPostalLine).toBe("Lund");
    const none = buildRentalData(
      { ...contract, counterpartyPostalCode: null, counterpartyCity: null },
      LESSOR,
    );
    expect(none.counterpartyPostalLine).toBeNull();
  });

  it("adds up the replacement values, quantities included", () => {
    // 2 × 6 500 + 1 × 4 200. The one figure on the page that is a real sum,
    // because it says what is at stake and nobody negotiates it.
    expect(buildRentalData(contract, LESSOR).totalReplacement).toBe("17 200,00 kr");
  });

  it("gives a quantity its unit, so it does not read as a fourth price", () => {
    expect(buildRentalData(contract, LESSOR).lines[0].quantity).toBe("2 st");
  });

  it("states the dates as ISO days, with no timezone in the way", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.pickupAt).toBe("2026-09-18");
    expect(d.returnAt).toBe("2026-09-21");
    // The day it was drawn, not the day it was signed.
    expect(d.drawn).toBe("2026-09-06");
  });

  it("puts each party in its own signature block", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.sectionParty?.name).toBe("Ludwig Gehlsdorf");
    expect(d.sectionParty?.title).toBe("Skattmästare");
    expect(d.counterpartyParty?.name).toBe("Emil Helander");
  });

  it("leaves a signature block empty rather than inventing one", () => {
    // A contract drawn before the renter has said who will sign. The document
    // still has to be signable by hand, so the block is ruled and left blank.
    const d = buildRentalData(
      { ...contract, parties: contract.parties.filter((p) => p.role === "SECTION") },
      LESSOR,
    );
    expect(d.counterpartyParty).toBeNull();
    expect(d.sectionParty).not.toBeNull();
  });

  it("carries the terms and the version they were drawn under", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.termsVersion).toBe(TERMS_VERSION);
    expect(d.terms.length).toBeGreaterThan(0);
    // The clauses are numbered by the template from this order, so the order
    // itself is part of what a contract refers to when it says "punkt 5".
    expect(d.terms[0].heading).toBe("Vad avtalet gäller");
  });
});
