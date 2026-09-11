import { describe, expect, it } from "vitest";

import { expenseDocuments, underlagCaption } from "./document-url";

const submitted = {
  id: "exp1",
  status: "APPROVED",
  receipts: [{ id: "rec1", mimeType: "", filename: "kvitto.jpg" }],
};

describe("expenseDocuments", () => {
  it("puts the cover first and the underlag behind it", () => {
    // Two documents, not one merged file: the panel stacks them into one
    // scroll, and the receipt is shown as it was stored rather than laid on a
    // white A4 sheet. The order is the one they are stapled in for Fortnox, so
    // scrolling through them reads the thing the section will actually file.
    expect(
      expenseDocuments({
        ...submitted,
        receipts: [{ id: "rec1", mimeType: "image/png", filename: "kvitto.png" }],
      }),
    ).toEqual([
      { src: "/api/expenses/exp1/document", mimeType: "application/pdf", label: undefined },
      {
        src: "/api/receipts/rec1",
        mimeType: "image/png",
        filename: undefined,
        label: undefined,
      },
    ]);
  });

  it("captions the two where the caller has words for them, naming the file", () => {
    // The panel stacks them, so something has to say where one ends and the
    // next begins. The words are the caller's: this file is client-safe and
    // knows nothing about locales. The file it was uploaded as is worth
    // knowing whether or not there is a second one to distinguish it from
    // (see underlagCaption).
    const docs = expenseDocuments(submitted, undefined, {
      cover: "Utläggsräkning",
      underlag: "Underlag",
    });
    expect(docs.map((d) => d.label)).toEqual(["Utläggsräkning", "Underlag – kvitto.jpg"]);
  });

  it("numbers the underlag only once there is more than one", () => {
    // Most utlägg have exactly one, and a caption counting a document nobody
    // else exists to be confused with would be answering a question nobody
    // asked.
    const docs = expenseDocuments(
      {
        ...submitted,
        receipts: [
          { id: "rec1", mimeType: "image/png", filename: "kvitto1.png" },
          { id: "rec2", mimeType: "application/pdf", filename: "faktura.pdf" },
        ],
      },
      undefined,
      { cover: "Utläggsräkning", underlag: "Underlag" },
    );
    expect(docs.map((d) => d.label)).toEqual([
      "Utläggsräkning",
      "Underlag 1 – kvitto1.png",
      "Underlag 2 – faktura.pdf",
    ]);
    expect(docs.map((d) => d.src)).toEqual([
      "/api/expenses/exp1/document",
      "/api/receipts/rec1",
      "/api/receipts/rec2",
    ]);
  });

  it("leaves a lone document uncaptioned, having nothing to tell it apart from", () => {
    const docs = expenseDocuments({ ...submitted, paymentType: "MILEAGE" }, undefined, {
      cover: "Utläggsräkning",
      underlag: "Underlag",
    });
    expect(docs).toHaveLength(1);
    expect(docs[0].label).toBeUndefined();
  });

  it("takes a photo for a receipt whose type the DTO didn't carry", () => {
    expect(
      expenseDocuments({
        ...submitted,
        receipts: [{ id: "rec1", mimeType: "", filename: "kvitto.jpg" }],
      })[1].mimeType,
    ).toBe("image/jpeg");
  });

  it("names the underlag for a reader who cannot see it", () => {
    expect(expenseDocuments(submitted, "Kvitto – Tejp")[1].filename).toBe("Kvitto – Tejp");
  });

  it("leaves the panel to say there is no underlag", () => {
    // Not the cover on its own: on the booking screen the empty panel is the
    // only warning that a voucher is about to be booked with nothing behind it.
    expect(expenseDocuments({ ...submitted, receipts: [] })).toEqual([]);
  });

  it("shows a draft its receipt and no cover", () => {
    // A draft has nothing attested and no reference yet, so its cover would be
    // a page of dashes, and drawing one costs a run of the typesetter every
    // time somebody opens their own half-finished utlägg.
    //
    // Unmarked: with one document there is nothing to choose between, and the
    // viewer opens on the first when nobody says otherwise.
    expect(expenseDocuments({ ...submitted, status: "DRAFT" })).toEqual([
      { src: "/api/receipts/rec1", mimeType: "image/jpeg", filename: undefined, label: undefined },
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
      expenseDocuments({ id: "exp1", status: "APPROVED", paymentType: "MILEAGE", receipts: [] }),
    ).toEqual([{ src: "/api/expenses/exp1/document", mimeType: "application/pdf" }]);
  });

  it("shows a mileage draft that same cover, unlike any other draft", () => {
    // The one place its journey can be read, so suppressing it until submission
    // would leave the submitter nothing to check.
    expect(
      expenseDocuments({ id: "exp1", status: "DRAFT", paymentType: "MILEAGE", receipts: [] }),
    ).toEqual([{ src: "/api/expenses/exp1/document", mimeType: "application/pdf" }]);
  });

  it("takes a missing utlägg without being asked to check first", () => {
    expect(expenseDocuments(null)).toEqual([]);
    expect(expenseDocuments(undefined)).toEqual([]);
  });
});

describe("underlagCaption", () => {
  it("names the file without a number when it is the only one", () => {
    expect(underlagCaption("Underlag", 0, 1, "kvitto.jpg")).toBe("Underlag – kvitto.jpg");
  });

  it("numbers each one once there is more than one", () => {
    expect(underlagCaption("Underlag", 0, 2, "kvitto1.jpg")).toBe("Underlag 1 – kvitto1.jpg");
    expect(underlagCaption("Underlag", 1, 2, "kvitto2.jpg")).toBe("Underlag 2 – kvitto2.jpg");
  });

  it("drops the dash rather than naming an empty file", () => {
    expect(underlagCaption("Underlag", 0, 1, undefined)).toBe("Underlag");
    expect(underlagCaption("Underlag", 0, 2, undefined)).toBe("Underlag 1");
  });
});
