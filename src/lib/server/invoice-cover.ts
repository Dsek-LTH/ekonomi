// The attest page that goes to Fortnox in front of a levfaktura's PDF: which
// invoice, how it was konterad, and who attested each row, when.
//
// The utläggsräkning's counterpart, and for the same reason: the invoice
// itself says what was bought, and this says who in the section agreed to pay
// for it. Fortnox keeps the two together with the supplier invoice, so the
// attest is part of the verifikat rather than something only this app knows.
//
// Drawn with pdf-lib rather than typst, unlike the utläggsräkning. It is one
// page of plain lines, and pdf-lib is what merges it with the invoice anyway.
import "server-only";

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { oreToSEK } from "@/lib/domain/money";
import { SECTION } from "@/lib/contract/section";

export interface CoverFacts {
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  amount: number; // öre
  description: string | null;
  resultUnit: string | null;
  rows: {
    costCenter: string; // "SEX01 - Sexmästeriet"
    account: string;
    amount: number; // öre
    attestedBy: string | null;
    attestedAt: Date | null;
    comment: string | null;
  }[];
  exportedBy: string;
}

const sek = new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK" });
// Plain spaces: the standard fonts have no glyph for the narrow no-break space
// Intl puts between thousands.
const money = (ore: number) => sek.format(oreToSEK(ore)).replace(/[  ]/g, " ");
const stamp = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Stockholm",
  dateStyle: "short",
  timeStyle: "short",
});

export async function renderInvoiceCover(f: CoverFacts): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const muted = rgb(0.4, 0.4, 0.4);
  const left = 56;
  let y = 780;

  const line = (text: string, opts: { size?: number; font?: typeof regular; x?: number; color?: typeof muted } = {}) => {
    page.drawText(text, {
      x: opts.x ?? left,
      y,
      size: opts.size ?? 10,
      font: opts.font ?? regular,
      color: opts.color,
    });
  };

  line("Attest av leverantörsfaktura", { size: 16, font: bold });
  y -= 18;
  line(SECTION.name + (SECTION.orgNo ? `, ${SECTION.orgNo}` : ""), { color: muted });
  y -= 30;

  const facts: [string, string][] = [
    ["Leverantör", f.supplierName],
    ["Fakturanummer", f.invoiceNumber],
    ["Fakturadatum", f.invoiceDate],
    ["Förfallodag", f.dueDate],
    ["Belopp", money(f.amount)],
    ...(f.resultUnit ? ([["Resultatenhet", f.resultUnit]] as [string, string][]) : []),
    ...(f.description ? ([["Avser", f.description]] as [string, string][]) : []),
  ];
  for (const [label, value] of facts) {
    line(label, { color: muted });
    line(value.slice(0, 80), { x: left + 110 });
    y -= 15;
  }

  y -= 20;
  line("Kontering och attest", { size: 12, font: bold });
  y -= 18;
  line("Kostnadsställe", { color: muted, size: 9 });
  line("Konto", { color: muted, size: 9, x: left + 220 });
  line("Belopp", { color: muted, size: 9, x: left + 280 });
  line("Attesterad av", { color: muted, size: 9, x: left + 360 });
  y -= 14;
  for (const r of f.rows) {
    line(r.costCenter.slice(0, 38));
    line(r.account, { x: left + 220 });
    line(money(r.amount), { x: left + 280 });
    line(r.attestedBy ?? "-", { x: left + 360 });
    y -= 12;
    if (r.attestedAt) {
      line(stamp.format(r.attestedAt), { x: left + 360, size: 8, color: muted });
      y -= 11;
    }
    if (r.comment) {
      line(r.comment.slice(0, 90), { size: 8, color: muted });
      y -= 11;
    }
    y -= 6;
  }

  y -= 20;
  line(`Exporterad till Fortnox av ${f.exportedBy}, ${stamp.format(new Date())}.`, { size: 9, color: muted });

  return doc.save();
}
