import { describe, expect, it } from "vitest";
import { renderInvoiceCover } from "./invoice-cover";
import { pdfLines } from "./pdf-text";

// The attest page as Fortnox will file it, read back the way the app reads any
// PDF. What matters is that it says who attested what, in Swedish.
describe("renderInvoiceCover", () => {
  it("names the invoice, the kontering and who attested it", async () => {
    const bytes = await renderInvoiceCover({
      supplierName: "Lunds Släpvagnsuthyrning AB",
      invoiceNumber: "20417",
      invoiceDate: "2026-10-20",
      dueDate: "2026-11-10",
      amount: 125000,
      description: "Släp till nollningen",
      resultUnit: "Sexmästeriet",
      rows: [
        {
          costCenter: "SEX01 - Sexmästeriet",
          account: "5615",
          amount: 125000,
          attestedBy: "Klara Ström",
          attestedAt: new Date("2026-10-27T10:00:00Z"),
          comment: null,
        },
      ],
      exportedBy: "Maja Holm",
    });
    const text = (await pdfLines(bytes)).join("\n");
    expect(text).toContain("Attest av leverantörsfaktura");
    expect(text).toContain("Lunds Släpvagnsuthyrning AB");
    expect(text).toContain("Förfallodag 2026-11-10");
    expect(text).toContain("Klara Ström");
    expect(text).toContain("1 250,00 kr");
    expect(text).toContain("Exporterad till Fortnox av Maja Holm");
  });
});
