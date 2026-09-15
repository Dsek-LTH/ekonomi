import { describe, expect, it } from "vitest";
import { renderRentalContract } from "./typst";
import { RENTAL_TERMS, TERMS_VERSION } from "./terms";
import type { RentalContractData } from "./types";
import { PDFDocument } from "pdf-lib";

// The live preview draws the contract while the form is still being filled in,
// so the template meets shapes the saved document never does: no dates, no
// renter, no lines at all. Each of these used to be impossible by construction
// and is now the ordinary state of the page for the first minute somebody is on
// it, which makes them the cases most likely to break the template.

const empty: RentalContractData = {
  lessor: {
    name: "D-sektionen inom TLTH",
    orgNo: "845001-1234",
    address: "Ole Römers väg 3",
    postalLine: "223 63 Lund",
  },
  counterparty: "",
  counterpartyOrgNo: null,
  counterpartyAddress: null,
  counterpartyPostalLine: null,
  counterpartyEmail: null,
  counterpartyPhone: null,
  title: "",
  drawn: "2026-09-07",
  pickupAt: null,
  returnAt: null,
  purpose: null,
  lines: [],
  anyDiscount: false,
  subtotal: "0,00 kr",
  discount: null,
  price: "0,00 kr",
  totalReplacement: "0,00 kr",
  signatureCount: 1,
  terms: RENTAL_TERMS,
  termsVersion: TERMS_VERSION,
};

const pages = async (d: RentalContractData) =>
  (await PDFDocument.load(await renderRentalContract(d))).getPageCount();

describe("the letterhead", () => {
  it("renders with the section's full details, which is the ordinary case", async () => {
    expect(await pages({ ...empty, counterparty: "F-sektionen inom TLTH" })).toBeGreaterThanOrEqual(1);
  });

  it("renders with no address at all, so a missing SECTION entry cannot break it", async () => {
    // lib/contract/section.ts is edited by hand, and a half-filled one must
    // still produce a document rather than a stack trace.
    expect(
      await pages({
        ...empty,
        lessor: { name: "D-sektionen inom TLTH", orgNo: null, address: null, postalLine: null },
      }),
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("the contract as a preview draws it", () => {
  it("renders an untouched form, which is what the panel shows on arrival", async () => {
    expect(await pages(empty)).toBeGreaterThanOrEqual(1);
  });

  it("renders with a period but nothing else, the usual second step", async () => {
    expect(await pages({ ...empty, pickupAt: "2026-09-18", returnAt: "2026-09-21" })).toBeGreaterThanOrEqual(1);
  });

  it("renders half a period, since one date is typed before the other", async () => {
    expect(await pages({ ...empty, pickupAt: "2026-09-18" })).toBeGreaterThanOrEqual(1);
  });

  it("renders a renter with no gear yet", async () => {
    expect(
      await pages({ ...empty, counterparty: "F-sektionen inom TLTH", title: "Uthyrning till F-sektionen" }),
    ).toBeGreaterThanOrEqual(1);
  });

  it("renders one line before it has a price", async () => {
    expect(
      await pages({
        ...empty,
        lines: [
          { description: "Högtalare", quantity: "1 st", unitPrice: "0,00 kr",
      discount: null, lineTotal: "0,00 kr", replacementValue: "0,00 kr" },
        ],
      }),
    ).toBeGreaterThanOrEqual(1);
  });
});
