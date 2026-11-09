import { describe, expect, it } from "vitest";
import { buildRentalData, type ContractForDocument } from "./document";
import { TERMS_VERSION } from "./rental/terms";

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
  counterpartyEmail: "ordf@fsektionen.se",
  counterpartyPhone: null,
  createdAt: new Date("2026-09-06T14:12:00.000Z"),
  rental: {
    pickupAt: new Date("2026-09-18T00:00:00.000Z"),
    returnAt: new Date("2026-09-21T00:00:00.000Z"),
    purpose: "Sittning i iDét",
    signatureCount: 2,
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
};

describe("buildRentalData", () => {
  it("writes money the way the rest of the app writes it in Swedish", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.subtotal).toBe("650,00 kr");
    expect(d.price).toBe("650,00 kr");
    expect(d.lines[0].unitPrice).toBe("250,00 kr");
  });

  it("charges the lines when nothing is discounted, and says so by omission", () => {
    // Null, not "0,00 kr": the template leaves the discount column out.
    const d = buildRentalData(contract, LESSOR);
    expect(d.discount).toBeNull();
    expect(d.anyDiscount).toBe(false);
    expect(d.lines.every((l) => l.discount === null)).toBe(true);
  });

  it("takes each line's own discount off to get the rent", () => {
    const d = buildRentalData(
      {
        ...contract,
        rental: {
          ...contract.rental,
          lines: contract.rental.lines.map((l, i) => (i === 0 ? { ...l, discountPercent: 30 } : l)),
        },
      },
      LESSOR,
    );
    expect(d.subtotal).toBe("650,00 kr");
    expect(d.discount).toBe("150,00 kr");
    expect(d.price).toBe("500,00 kr");
    expect(d.lines[0].discount).toBe("30 %");
    expect(d.lines[0].lineTotal).toBe("350,00 kr");
    expect(d.lines[1].discount).toBeNull();
    expect(d.anyDiscount).toBe(true);
  });

  it("lends for nothing when every line is fully discounted", () => {
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
    const half = buildRentalData({ ...contract, counterpartyPostalCode: null }, LESSOR);
    expect(half.counterpartyPostalLine).toBe("Lund");
    const none = buildRentalData(
      { ...contract, counterpartyPostalCode: null, counterpartyCity: null },
      LESSOR,
    );
    expect(none.counterpartyPostalLine).toBeNull();
  });

  it("adds up the replacement values, quantities included", () => {
    expect(buildRentalData(contract, LESSOR).totalReplacement).toBe("17 200,00 kr");
  });

  it("gives a quantity its unit, so it does not read as a fourth price", () => {
    expect(buildRentalData(contract, LESSOR).lines[0].quantity).toBe("2 st");
  });

  it("states the dates as ISO days, with no timezone in the way", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.pickupAt).toBe("2026-09-18");
    expect(d.returnAt).toBe("2026-09-21");
    expect(d.drawn).toBe("2026-09-06");
  });

  it("asks for as many signature blocks as the rental says", () => {
    expect(buildRentalData(contract, LESSOR).signatureCount).toBe(2);
  });

  it("carries the renter's contact details beside the address", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.counterpartyEmail).toBe("ordf@fsektionen.se");
    expect(d.counterpartyPhone).toBeNull();
  });

  it("carries the terms and the version they were drawn under", () => {
    const d = buildRentalData(contract, LESSOR);
    expect(d.termsVersion).toBe(TERMS_VERSION);
    expect(d.terms.length).toBeGreaterThan(0);
    // The template numbers clauses from this order, so it is part of what "§ 5" refers to.
    expect(d.terms[0].heading).toBe("Vad avtalet gäller");
  });
});
