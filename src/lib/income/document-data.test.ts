import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildIncomeDocumentData, type DocumentSourceLine } from "./document-data";
import { renderIncomePdf } from "./render";

const line = (over: Partial<DocumentSourceLine> = {}): DocumentSourceLine => ({
  kind: "SALE",
  unitName: "Caféutskottet",
  name: "Kaffe",
  variant: null,
  account: "3000",
  accountName: "Försäljning",
  costCenter: { code: "CAFE02", name: "D-café" },
  quantity: 2,
  unitPrice: 1000,
  discount: 0,
  total: 2000,
  ...over,
});

const day = (lines: DocumentSourceLine[]) =>
  buildIncomeDocumentData({
    source: "ZETTLE",
    date: "2026-11-07",
    created: "2026-11-08",
    attestation: { name: "Anna Andersson", studentId: null },
    lines,
  });

const pub = line({
  unitName: "Sexmästeriet",
  name: "Öl",
  account: "3011",
  accountName: "Öl",
  costCenter: { code: "SEX03", name: "Pubar" },
  quantity: 3,
  unitPrice: 4000,
  total: 12000,
});

const fee = line({
  kind: "FEE",
  unitName: null,
  name: "Zettleavgift",
  account: "6570",
  accountName: "Bankkostnader",
  costCenter: { code: "SKT02", name: "Avgifter" },
  quantity: 4,
  unitPrice: -50,
  total: -200,
});

describe("buildIncomeDocumentData", () => {
  it("gives every verksamhet a section of its own, by name", () => {
    const data = day([pub, line()]);
    expect(data.sections.map((s) => [s.title, s.total])).toEqual([
      ["Caféutskottet", "20,00"],
      ["Sexmästeriet", "120,00"],
    ]);
  });

  it("puts the fees in a section after the sales, and nets them in the total", () => {
    const data = day([line(), fee]);
    expect(data.fees).toMatchObject({ title: "Zettleavgifter", total: "−" + "2,00" });
    expect(data.salesTotal).toBe("20,00");
    expect(data.total).toBe("18,00");
  });

  it("has no fee section on a day without fees", () => {
    expect(day([line()]).fees).toBeNull();
  });

  // The table a reader lays beside the voucher: same rows, same figures.
  it("distributes by account and cost centre, as the voucher does", () => {
    const data = day([
      line(),
      line({ name: "Bulle", unitPrice: 500, quantity: 1, total: 500 }),
      line({ costCenter: { code: "CAFE04", name: "Övriga evenemang" }, total: 300 }),
      pub,
      fee,
    ]);
    expect(data.distribution.map((d) => [d.account, d.costCenter, d.amount])).toEqual([
      ["3000", "CAFE02 - D-café", "25,00"],
      ["3000", "CAFE04 - Övriga evenemang", "3,00"],
      ["3011", "SEX03 - Pubar", "120,00"],
      ["6570", "SKT02 - Avgifter", "−" + "2,00"],
    ]);
  });

  it("says a missing cost centre and StiL-ID as a dash, not a blank", () => {
    const data = day([line({ costCenter: null })]);
    expect(data.distribution[0].costCenter).toBe("-");
    expect(data.attestation.studentId).toBe("-");
  });

  // The same grouping as the review screen: each verksamhet's products under
  // their account, each account with its sum.
  it("groups a section's products by account, each with its sum", () => {
    const data = day([
      line(),
      line({ name: "Öl", account: "3011", accountName: "Öl", quantity: 1, unitPrice: 4000, total: 4000 }),
      line({ name: "Bulle", unitPrice: 500, quantity: 1, total: 500 }),
    ]);
    expect(
      data.sections[0].accounts.map((a) => [a.account, a.name, a.total, a.rows.length]),
    ).toEqual([
      ["3000", "Försäljning", "25,00", 2],
      ["3011", "Öl", "40,00", 1],
    ]);
  });

  it("draws the discount column only when something was discounted", () => {
    expect(day([line()]).discounts).toBe(false);
    expect(day([line({ discount: 500, total: 1500 })]).discounts).toBe(true);
  });
});

describe("renderIncomePdf", () => {
  it("typesets a day with several verksamheter, variants, discounts and fees", async () => {
    const bytes = await renderIncomePdf(
      day([
        line(),
        line({ name: "Läsk", variant: "Stor", discount: 100, total: 1900 }),
        line({ name: "Läsk", variant: "Liten" }),
        pub,
        fee,
      ]),
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("typesets a day of fees alone", async () => {
    const bytes = await renderIncomePdf(day([fee]));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
