import { describe, expect, it } from "vitest";
import { buildRentalData, type ContractForDocument } from "./document";
import { TERMS_VERSION } from "./rental/terms";

// What the document *says*, asserted without going near a typesetter. Whether
// the template still compiles is rental/typst.test.ts's question; this one is
// about the wording and the arithmetic, which is where the decisions are.

const LESSOR = { name: "D-sektionen inom TLTH", orgNo: "845001-1234" };

const contract: ContractForDocument = {
  title: "Uthyrning av ljudanläggning",
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  createdAt: new Date("2026-09-06T14:12:00.000Z"),
  rental: {
    pickupAt: new Date("2026-09-18T00:00:00.000Z"),
    returnAt: new Date("2026-09-21T00:00:00.000Z"),
    purpose: "Sittning i iDét",
    place: "Kårhuset, Lund",
    priceOre: 65_000,
    depositOre: 100_000,
    lines: [
      {
        description: "Högtalare, aktiv 12 tum",
        quantity: 2,
        unitPriceOre: 25_000,
        replacementValueOre: 650_000,
      },
      {
        description: "Mixerbord 8 kanaler",
        quantity: 1,
        unitPriceOre: 15_000,
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
    expect(d.price).toBe("650,00 kr");
    expect(d.deposit).toBe("1 000,00 kr");
    expect(d.lines[0].unitPrice).toBe("250,00 kr");
  });

  it("prints the rent that was agreed, not the lines added up", () => {
    // The lines come to 650 kr here, but the two are not the same question. A
    // rental priced as a whole, or lent for nothing, must print what was agreed.
    const free = buildRentalData(
      { ...contract, rental: { ...contract.rental, priceOre: 0 } },
      LESSOR,
    );
    expect(free.price).toBe("0,00 kr");
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
