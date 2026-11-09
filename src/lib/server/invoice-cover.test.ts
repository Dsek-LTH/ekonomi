import { describe, expect, it } from "vitest";
import { buildInvoiceCoverData, renderInvoiceCover, type CoverFacts } from "./invoice-cover";
import { pdfLines } from "./pdf-text";

const facts: CoverFacts = {
  reference: "LEV26-0012",
  supplierName: "Lunds Släpvagnsuthyrning AB",
  invoiceNumber: "20417",
  invoiceDate: "2026-10-20",
  dueDate: "2026-11-10",
  amount: 125000,
  description: "Släp till nollningen",
  resultUnit: "Sexmästeriet",
  rows: [
    {
      costCenter: "SEX01",
      amount: 125000,
      attestedBy: "Klara Ström",
      attestedAt: new Date("2026-10-27T10:00:00Z"),
      comment: null,
    },
  ],
  booking: { by: "Maja Holm", at: new Date("2026-10-28T09:00:00Z") },
  exportedBy: "Maja Holm",
  created: new Date("2026-11-01T12:00:00Z"),
};

describe("buildInvoiceCoverData", () => {
  it("words the money and dates as the utläggsräkning does", () => {
    const data = buildInvoiceCoverData(facts);
    // Intl groups thousands with a no-break space, which Inter has.
    expect(data.total).toBe("1\u00a0250,00 kr");
    expect(data.created).toBe("2026-11-01");
    expect(data.allocations[0]).toEqual({
      costCenter: "SEX01",
      amount: "1\u00a0250,00 kr",
      comment: null,
      approvedBy: "Klara Ström",
      approvedAt: "2026-10-27",
    });
    expect(data.booking).toEqual({ by: "Maja Holm", at: "2026-10-28" });
  });

  it("dates a signature by the day in Stockholm", () => {
    const late = {
      ...facts,
      rows: [{ ...facts.rows[0], attestedAt: new Date("2026-10-27T23:30:00Z") }],
    };
    expect(buildInvoiceCoverData(late).allocations[0].approvedAt).toBe("2026-10-28");
  });

  it("leaves the kontering blank where the history has none", () => {
    expect(buildInvoiceCoverData({ ...facts, booking: null }).booking).toEqual({
      by: null,
      at: null,
    });
  });
});

// The attest page as Fortnox will file it, read back like any PDF: it says who attested what, in Swedish.
describe("renderInvoiceCover", () => {
  it("names the invoice and who attested and konterade it", async () => {
    const text = (await pdfLines(await renderInvoiceCover(facts))).join("\n");
    expect(text).toContain("Leverantörsfaktura");
    expect(text).toContain("Lunds Släpvagnsuthyrning AB");
    expect(text).toContain("LEV26-0012");
    expect(text).toContain("Klara Ström");
    expect(text).toContain("1 250,00 kr");
    expect(text).toContain("Maja Holm");
  });
});
