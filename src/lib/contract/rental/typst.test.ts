import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { renderRentalContract } from "./typst";
import { RENTAL_TERMS, TERMS_VERSION } from "./terms";
import type { RentalContractData } from "./types";

// The same bargain the cover's tests strike: these run everywhere with no skip
// guard, because the typesetter is a dependency rather than something the
// machine has to have.
//
// What the document *says* is tested in ../document.test.ts without going near
// a renderer. These only ask whether the template still compiles into pages,
// which is the failure a template edit actually causes.

const data: RentalContractData = {
  lessor: { name: "D-sektionen inom TLTH", orgNo: "845001-1234" },
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  title: "Uthyrning av ljudanläggning",
  drawn: "2026-09-06",
  pickupAt: "2026-09-18",
  returnAt: "2026-09-21",
  purpose: "Sittning i iDét",
  place: "Kårhuset, Lund",
  lines: [
    {
      description: "Högtalare, aktiv 12 tum",
      quantity: "2 st",
      unitPrice: "250,00 kr",
      lineTotal: "500,00 kr",
      replacementValue: "6 500,00 kr",
    },
    {
      description: "Mixerbord 8 kanaler",
      quantity: "1 st",
      unitPrice: "150,00 kr",
      lineTotal: "150,00 kr",
      replacementValue: "4 200,00 kr",
    },
  ],
  price: "650,00 kr",
  deposit: "1 000,00 kr",
  totalReplacement: "17 200,00 kr",
  sectionParty: {
    name: 'Ludwig "Alphan" Gehlsdorf',
    title: "Skattmästare",
    orgName: null,
    orgNo: null,
    email: null,
    phone: null,
  },
  counterpartyParty: {
    name: "Emil Helander",
    title: "Ordförande F-sektionen",
    orgName: "F-sektionen inom TLTH",
    orgNo: "845002-5678",
    email: "ordf@fsektionen.se",
    phone: "070-123 45 67",
  },
  terms: RENTAL_TERMS,
  termsVersion: TERMS_VERSION,
};

describe("renderRentalContract", () => {
  it("renders an A4 contract", async () => {
    const bytes = await renderRentalContract(data);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 0);
  });

  it("survives everything the data allows to be missing", async () => {
    // A draft drawn before the renter has said who will sign, for a private
    // person with no organisation number, lent for nothing with no deposit and
    // no stated place or purpose. Every optional field absent at once, which is
    // the shape most likely to blow up a template that assumed otherwise.
    const bytes = await renderRentalContract({
      ...data,
      counterparty: "Anna Andersson",
      counterpartyOrgNo: null,
      purpose: null,
      place: null,
      price: "0,00 kr",
      deposit: "0,00 kr",
      sectionParty: { ...data.sectionParty!, title: null },
      counterpartyParty: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders a contract with one line and no signatories at all", async () => {
    const bytes = await renderRentalContract({
      ...data,
      lines: [data.lines[0]],
      sectionParty: null,
      counterpartyParty: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
