import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";

import { renderRentalContract } from "./typst";
import { RENTAL_TERMS, TERMS_VERSION } from "./terms";
import type { RentalContractData } from "./types";

// The contract is set in the guild's own faces, the ones dsekdoc.cls names.
//
// This guards a failure that is silent and expensive: Typst falls back when a
// named family is missing, so a vendored .otf that does not reach the container
// produces a document that renders, has the right words in the right places,
// and is in the wrong hand. Nothing throws and no test that only counts pages
// would notice. What a renter signs would then not match what was checked on
// the laptop it was drawn on.
//
// Read off the PDF's own font table rather than trusted from the template,
// because the template only *asks* for a family.

const party = (name: string, title: string | null) => ({
  name,
  title,
  orgName: null,
  orgNo: null,
  email: null,
  phone: null,
});

const data: RentalContractData = {
  lessor: {
    name: "D-sektionen inom TLTH",
    orgNo: "845003-2878",
    address: "Ole Römers väg 3",
    postalLine: "223 63 Lund",
  },
  counterparty: "F-sektionen inom TLTH",
  counterpartyOrgNo: "845002-5678",
  counterpartyAddress: "Ole Römers väg 3",
  counterpartyPostalLine: "223 63 Lund",
  title: "Uthyrning av ljudanläggning",
  drawn: "2026-09-07",
  pickupAt: "2026-09-18",
  returnAt: "2026-09-21",
  purpose: "Sittning i iDét",
  place: "Kårhuset, Lund",
  lines: [
    {
      description: "Högtalare, aktiv 12 tum",
      quantity: "2 st",
      unitPrice: "250,00 kr",
      discount: null,
      lineTotal: "500,00 kr",
      replacementValue: "6 500,00 kr",
    },
  ],
  anyDiscount: false,
  subtotal: "500,00 kr",
  discount: "150,00 kr",
  price: "350,00 kr",
  paymentDue: "2026-09-15",
  totalReplacement: "13 000,00 kr",
  sectionParty: party("Maja Holm", "Skattmästare"),
  counterpartyParty: party("Emil Helander", null),
  terms: RENTAL_TERMS,
  termsVersion: TERMS_VERSION,
};

/** The families the PDF actually embeds, without the subset prefix. */
const embeddedFonts = (bytes: Uint8Array): string[] => [
  ...new Set(
    [...Buffer.from(bytes).toString("latin1").matchAll(/\/BaseFont\s*\/[A-Z]{6}\+([A-Za-z0-9-]+)/g)]
      .map((m) => m[1].replace(/-Identity-H$/, "")),
  ),
].sort();

describe("the uthyrningsavtal is set in the guild's hand", () => {
  it("embeds Domitian and TeX Gyre Heros, and nothing else", async () => {
    const fonts = embeddedFonts(await renderRentalContract(data));
    expect(fonts.length).toBeGreaterThan(0);
    // Anything else here means a family was named and not found, and Typst
    // quietly reached for Libertinus instead.
    expect(fonts.filter((f) => !/^(Domitian|TeXGyreHeros)-/.test(f))).toEqual([]);
    // Both families are actually in use: the body is the serif, the headings
    // are the sans, and losing either would still pass a one-family check.
    expect(fonts.some((f) => f.startsWith("Domitian-"))).toBe(true);
    expect(fonts.some((f) => f.startsWith("TeXGyreHeros-"))).toBe(true);
  });

  it("is A4, as the class sets it", async () => {
    const doc = await PDFDocument.load(await renderRentalContract(data));
    const page = doc.getPage(0);
    expect(page.getWidth()).toBeCloseTo(595.28, 0);
    expect(page.getHeight()).toBeCloseTo(841.89, 0);
  });
});
