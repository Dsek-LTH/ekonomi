import { describe, expect, it } from "vitest";

import { expenseDocuments } from "./document-url";

const submitted = { id: "exp1", status: "APPROVED", receiptId: "rec1" };

describe("expenseDocuments", () => {
  it("puts the cover first and the underlag behind it", () => {
    // Two documents, not one merged file: the pager moves between them, and
    // the receipt is shown as it was stored rather than laid on a white sheet.
    // The order is the one they are stapled in for Fortnox, so paging through
    // them reads the thing the section will actually file.
    expect(expenseDocuments({ ...submitted, receiptMimeType: "image/png" })).toEqual([
      { src: "/api/expenses/exp1/document", mimeType: "application/pdf" },
      { src: "/api/receipts/rec1", mimeType: "image/png", filename: undefined, defaultOpen: true },
    ]);
  });

  it("opens on the underlag all the same", () => {
    // Order and landing page are two different questions. The cover leads the
    // document; the receipt is what somebody came to look at, so it is marked
    // rather than moved — and exactly one of them is.
    const docs = expenseDocuments(submitted);
    expect(docs.map((d) => Boolean(d.defaultOpen))).toEqual([false, true]);
  });

  it("takes a photo for a receipt whose type the DTO didn't carry", () => {
    expect(expenseDocuments(submitted)[1].mimeType).toBe("image/jpeg");
  });

  it("names the underlag for a reader who cannot see it", () => {
    expect(expenseDocuments(submitted, "Kvitto · Tejp")[1].filename).toBe("Kvitto · Tejp");
  });

  it("leaves the panel to say there is no underlag", () => {
    // Not the cover on its own: on the booking screen the empty panel is the
    // only warning that a voucher is about to be booked with nothing behind it.
    expect(expenseDocuments({ ...submitted, receiptId: null })).toEqual([]);
    expect(expenseDocuments({ ...submitted, receiptId: undefined })).toEqual([]);
  });

  it("shows a draft its receipt and no cover", () => {
    // A draft has nothing attested and no reference yet, so its cover would be
    // a page of dashes — and drawing one costs a run of the typesetter every
    // time somebody opens their own half-finished utlägg.
    //
    // Unmarked: with one document there is nothing to choose between, and the
    // viewer opens on the first when nobody says otherwise.
    expect(expenseDocuments({ ...submitted, status: "DRAFT" })).toEqual([
      { src: "/api/receipts/rec1", mimeType: "image/jpeg", filename: undefined },
    ]);
  });

  it("shows the cover for every status a draft has become", () => {
    for (const status of [
      "PENDING_MATCH",
      "PENDING_APPROVAL",
      "CHANGES_REQUESTED",
      "APPROVED",
      "BOOKED",
      "EXPORTED",
    ]) {
      expect(expenseDocuments({ ...submitted, status })).toHaveLength(2);
    }
  });

  it("gives a milersättning one document, the cover it is printed on", () => {
    // Nothing to photograph about driving your own car, so the journey is a
    // section of the utläggsräkning rather than a document behind it. Two
    // pages saying the same reference, submitter and total is what this
    // replaced.
    expect(
      expenseDocuments({ id: "exp1", status: "APPROVED", paymentType: "MILEAGE" }),
    ).toEqual([{ src: "/api/expenses/exp1/document", mimeType: "application/pdf" }]);
  });

  it("shows a mileage draft that same cover, unlike any other draft", () => {
    // The one place its journey can be read, so suppressing it until submission
    // would leave the submitter nothing to check.
    expect(
      expenseDocuments({ id: "exp1", status: "DRAFT", paymentType: "MILEAGE" }),
    ).toEqual([{ src: "/api/expenses/exp1/document", mimeType: "application/pdf" }]);
  });

  it("takes a missing utlägg without being asked to check first", () => {
    expect(expenseDocuments(null)).toEqual([]);
    expect(expenseDocuments(undefined)).toEqual([]);
  });
});
