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
  lessor: {
    name: "D-sektionen inom TLTH",
    orgNo: "845001-1234",
    address: "Ole Römers väg 3",
    postalLine: "223 63 Lund",
  },
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  counterpartyAddress: "Ole Römers väg 3",
  counterpartyPostalLine: "223 63 Lund",
  counterpartyEmail: "ordf@fsektionen.se",
  counterpartyPhone: "070-123 45 67",
  title: "Uthyrning av ljudanläggning",
  drawn: "2026-09-06",
  pickupAt: "2026-09-18",
  returnAt: "2026-09-21",
  purpose: "Sittning i iDét",
  lines: [
    {
      description: "Högtalare, aktiv 12 tum",
      quantity: "2 st",
      unitPrice: "250,00 kr",
      discount: null,
      lineTotal: "500,00 kr",
      replacementValue: "6 500,00 kr",
    },
    {
      description: "Mixerbord 8 kanaler",
      quantity: "1 st",
      unitPrice: "150,00 kr",
      discount: null,
      lineTotal: "150,00 kr",
      replacementValue: "4 200,00 kr",
    },
  ],
  anyDiscount: false,
  subtotal: "650,00 kr",
  discount: "150,00 kr",
  price: "500,00 kr",
  totalReplacement: "17 200,00 kr",
  signatureCount: 1,
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
    // A draft with no contact details at all, for a private
    // person with no organisation number and no address, charged the full
    // subtotal with no discount row, and with no stated place or purpose. Every
    // optional field absent at once, which is the shape most likely to blow up
    // a template that assumed otherwise.
    const bytes = await renderRentalContract({
      ...data,
      counterparty: "Anna Andersson",
      counterpartyOrgNo: null,
      counterpartyAddress: null,
      counterpartyPostalLine: null,
      purpose: null,
      discount: null,
      price: data.subtotal,
      counterpartyEmail: null,
      counterpartyPhone: null,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders a rental lent for nothing, where the whole subtotal comes off", async () => {
    const bytes = await renderRentalContract({
      ...data,
      discount: data.subtotal,
      price: "0,00 kr",
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders several signature blocks, over more than one row", async () => {
    const bytes = await renderRentalContract({ ...data, signatureCount: 5 });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("renders one line and a signature count of zero, which still draws a block", async () => {
    const bytes = await renderRentalContract({
      ...data,
      lines: [data.lines[0]],
      signatureCount: 0,
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
