import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pdfLines } from "./pdf-text";
import { prefillData, readInvoicePdf } from "./invoice-prefill";

// The whole path a real invoice takes: a PDF with a text layer, read by pdfjs
// the way the server reads it, parsed, and turned into the write that fills
// the invoice. The PDF is drawn here with pdf-lib, laid out the way an invoice
// is, with labels on the left and values far to the right of them.

async function invoicePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const at = (text: string, x: number, y: number) => page.drawText(text, { x, y, size: 10, font });
  at("Lunds Släpvagnsuthyrning AB", 50, 800);
  at("Org.nr 556677-8899", 50, 785);
  at("Fakturanummer", 350, 760);
  at("20417", 480, 760);
  at("Fakturadatum", 350, 745);
  at("2026-10-20", 480, 745);
  at("Förfallodatum", 350, 730);
  at("2026-11-10", 480, 730);
  at("Kund: D-sektionen inom TLTH, org.nr 845003-2878", 50, 700);
  at("Er referens: SEX01", 50, 685);
  at("Att betala", 350, 400);
  at("1 250,00", 480, 400);
  at("Bankgiro 5050-1055", 50, 100);
  at("OCR 123456789012", 300, 100);
  return doc.save();
}

describe("reading an invoice PDF", () => {
  it("gives its lines in reading order, label and value on one line", async () => {
    const lines = await pdfLines(await invoicePdf());
    expect(lines[0]).toBe("Lunds Släpvagnsuthyrning AB");
    expect(lines).toContain("Att betala 1 250,00");
    expect(lines).toContain("Fakturanummer 20417");
  });

  it("finds the fields", async () => {
    const fields = await readInvoicePdf(await invoicePdf(), "application/pdf");
    expect(fields).toEqual({
      amount: 125000,
      dueDate: "2026-11-10",
      invoiceNumber: "20417",
      invoiceDate: "2026-10-20",
      bankgiro: "5050-1055",
      ocr: "123456789012",
      supplierOrgNo: "556677-8899",
      reference: "SEX01",
    });
  });

  it("reads nothing from something that is not a PDF, and does not throw", async () => {
    expect(await readInvoicePdf(new TextEncoder().encode("not a pdf"), "application/pdf")).toEqual({});
    expect(await readInvoicePdf(new Uint8Array([1, 2, 3]), "image/jpeg")).toEqual({});
  });
});

describe("prefillData", () => {
  it("fills only what is empty, and says what it filled", () => {
    const data = prefillData(
      { invoiceNumber: "typed-by-hand", amount: null, prefilled: [] },
      { invoiceNumber: "20417", amount: 125000, dueDate: "2026-11-10", reference: "SEX01" },
    );
    expect(data).toEqual({
      amount: 125000,
      dueDate: new Date("2026-11-10T00:00:00.000Z"),
      yourReference: "SEX01",
      prefilled: ["amount", "dueDate", "yourReference"],
    });
  });

  it("names the register's supplier and picks it for the export", () => {
    const supplier = { number: "42", name: "Lunds Släpvagnsuthyrning AB" };
    expect(prefillData({}, { supplierOrgNo: "556677-8899" }, supplier)).toEqual({
      supplierOrgNo: "556677-8899",
      supplierName: "Lunds Släpvagnsuthyrning AB",
      fortnoxSupplierNumber: "42",
      prefilled: ["supplierOrgNo", "supplierName"],
    });
    // A name somebody typed stays, and so does a supplier already picked.
    expect(prefillData({ supplierName: "Släpet", fortnoxSupplierNumber: "7" }, {}, supplier)).toEqual({});
  });

  it("is nothing at all when there is nothing to fill", () => {
    expect(prefillData({ amount: 1 }, { amount: 2 })).toEqual({});
  });
});
