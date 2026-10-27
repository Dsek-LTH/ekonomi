import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseInvoiceText } from "./invoice-text";

describe("parseDate", () => {
  it.each([
    ["2026-11-10", "2026-11-10"],
    ["2026.11.10", "2026-11-10"],
    ["20261110", "2026-11-10"],
    ["10.11.2026", "2026-11-10"],
    ["10/11/2026", "2026-11-10"],
    ["261110", "2026-11-10"],
  ])("reads %s", (raw, iso) => {
    expect(parseDate(raw)).toBe(iso);
  });

  it("refuses what is not a date", () => {
    expect(parseDate("2026-13-40")).toBeNull();
    expect(parseDate("30 dagar netto")).toBeNull();
  });
});

describe("parseAmount", () => {
  it.each([
    ["1 250,00", 125000],
    ["1.250,00 kr", 125000],
    ["SEK 1250.00", 125000],
    ["1 250,50", 125050],
    ["Summa 3 st 4 200,00", 420000],
    ["950 kr", 95000],
  ])("reads %s", (raw, ore) => {
    expect(parseAmount(raw)).toBe(ore);
  });
});

describe("parseInvoiceText", () => {
  const invoice = [
    "Lunds Släpvagnsuthyrning AB",
    "Org.nr 556677-8899",
    "Faktura",
    "Fakturanummer: 20417",
    "Fakturadatum 2026-10-20",
    "Förfallodatum 2026-11-10",
    "Kund: D-sektionen inom TLTH",
    "Org.nr 845003-2878",
    "Er referens: SEX01 Klara",
    "Hyra släp 2 dagar        1 000,00",
    "Summa                    1 000,00",
    "Moms 0%                      0,00",
    "Att betala               1 250,00",
    "Bankgiro 5050-1055",
    "OCR 1234 5678 9012",
  ];

  it("reads every field off a typical Swedish invoice", () => {
    expect(parseInvoiceText(invoice, { ownOrgNo: "845003-2878" })).toEqual({
      amount: 125000,
      dueDate: "2026-11-10",
      invoiceDate: "2026-10-20",
      invoiceNumber: "20417",
      ocr: "123456789012",
      bankgiro: "5050-1055",
      supplierOrgNo: "556677-8899",
      reference: "SEX01 Klara",
    });
  });

  it("prefers the sum to pay over a subtotal", () => {
    expect(parseInvoiceText(["Summa 1 000,00", "Att betala 1 250,00"]).amount).toBe(125000);
    expect(parseInvoiceText(["Summa 1 000,00"]).amount).toBe(100000);
  });

  it("reads a value that stands on the line under its label", () => {
    expect(parseInvoiceText(["Förfallodag", "2026-11-10"]).dueDate).toBe("2026-11-10");
  });

  it("never takes the section's own org number for the supplier's", () => {
    expect(parseInvoiceText(["Kund org.nr 845003-2878"], { ownOrgNo: "845003-2878" }).supplierOrgNo).toBeUndefined();
  });

  it("finds nothing in nothing, which is what a scanned invoice gives", () => {
    expect(parseInvoiceText([])).toEqual({});
  });
});
