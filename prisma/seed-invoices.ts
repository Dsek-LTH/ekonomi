// Levfakturor for the seed: the Inkorg as triage meets it, and an invoice in every status after it.
//
// The Inkorg holds what a term brings: a forwarded mail with its whole text, a mail with an invoice and its
// specification, a hand upload, a mail from before the text was kept, and one sent back by a unit with a long
// reason. Fakturor has every status, given to the units the dev sign-ins answer for (Oskar Berg's
// Näringslivsutskottet and Infoutskottet), so each sign-in has something waiting.
//
// Every PDF is drawn here with pdf-lib and has a text layer laid out the way a supplier's is, with the labels
// lib/domain/invoice-text.ts reads ("Att betala", "Förfallodatum", "OCR"), so the fördelning's prefill works on them.
import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { PrismaClient, SupplierInvoiceEventType } from "../src/lib/generated/prisma/client";
import { formatReference } from "../src/lib/domain/reference";
import { matchSupplier } from "../src/lib/domain/payment-ref";
import { putObject } from "../scripts/storage-admin";

// ── The PDFs ─────────────────────────────────────────────────────

interface InvoicePdf {
  supplier: { name: string; address: string; orgNo: string; bankgiro: string };
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  ocr: string;
  /** Er referens, as the section gave it to the supplier. */
  reference?: string;
  lines: { text: string; amount: number }[]; // SEK
}

const sek = (n: number) =>
  n
    .toFixed(2)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** An OCR number: `base` with the modulus 10 check digit a real one ends in (isValidOcr), so the PDF reader takes it. */
function withCheckDigit(base: string): string {
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    let d = Number(base[base.length - 1 - i]);
    // The check digit will sit rightmost, so the base's rightmost digit is the first one doubled.
    if (i % 2 === 0) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    sum += d;
  }
  return base + String((10 - (sum % 10)) % 10);
}

const total = (pdf: InvoicePdf) => pdf.lines.reduce((s, l) => s + l.amount, 0);

/** One A4 invoice page, plain the way a small supplier's is. */
export async function renderInvoice(pdf: InvoicePdf): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.15, 0.15, 0.15);
  let y = 790;
  const text = (s: string, x: number, opts: { size?: number; bold?: boolean } = {}) =>
    page.drawText(s, { x, y, size: opts.size ?? 10, font: opts.bold ? bold : font, color: ink });
  const right = (s: string, xRight: number, opts: { bold?: boolean } = {}) => {
    const f = opts.bold ? bold : font;
    page.drawText(s, { x: xRight - f.widthOfTextAtSize(s, 10), y, size: 10, font: f, color: ink });
  };

  text(pdf.supplier.name, 50, { size: 16, bold: true });
  text("FAKTURA", 440, { size: 16, bold: true });
  y -= 18;
  text(pdf.supplier.address, 50);
  y -= 40;

  // Each label with its value on the same line, as most invoices print them.
  const facts: [string, string][] = [
    ["Fakturanummer", pdf.invoiceNumber],
    ["Fakturadatum", pdf.invoiceDate],
    ["Förfallodatum", pdf.dueDate],
    ...(pdf.reference ? [["Er referens", pdf.reference] as [string, string]] : []),
  ];
  text("Kund", 50, { bold: true });
  text(facts[0][0], 330);
  text(facts[0][1], 440);
  y -= 14;
  text("Datavetenskapssektionen inom TLTH", 50);
  text(facts[1][0], 330);
  text(facts[1][1], 440);
  y -= 14;
  text("Box 118, 221 00 Lund", 50);
  text(facts[2][0], 330);
  text(facts[2][1], 440);
  for (const [label, value] of facts.slice(3)) {
    y -= 14;
    text(label, 330);
    text(value, 440);
  }
  y -= 50;

  text("Beskrivning", 50, { bold: true });
  right("Belopp", 545, { bold: true });
  y -= 6;
  page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: ink });
  y -= 16;
  for (const l of pdf.lines) {
    text(l.text, 50);
    right(`${sek(l.amount)} kr`, 545);
    y -= 16;
  }
  page.drawLine({
    start: { x: 330, y: y + 6 },
    end: { x: 545, y: y + 6 },
    thickness: 0.5,
    color: ink,
  });
  y -= 10;
  text("Att betala", 330, { bold: true });
  right(`${sek(total(pdf))} kr`, 545, { bold: true });
  y -= 50;

  text("Betalningsinformation", 50, { bold: true });
  y -= 16;
  text(`Bankgiro ${pdf.supplier.bankgiro}`, 50);
  y -= 14;
  text(`OCR ${pdf.ocr}`, 50);
  y -= 14;
  text("Momsbefriad kund. Dröjsmålsränta enligt räntelagen.", 50);

  y = 60;
  text(`${pdf.supplier.name}  -  Org.nr ${pdf.supplier.orgNo}  -  ${pdf.supplier.address}`, 50, {
    size: 8,
  });
  return Buffer.from(await doc.save());
}

/** A specification: rows of what was delivered, with no sum to pay, so nothing on it is read as the invoice's. */
async function renderSpecification(title: string, rows: [string, string][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = 790;
  page.drawText(title, { x: 50, y, size: 14, font: bold });
  y -= 30;
  for (const [what, qty] of rows) {
    page.drawText(what, { x: 50, y, size: 10, font });
    page.drawText(qty, { x: 450, y, size: 10, font });
    y -= 16;
  }
  return Buffer.from(await doc.save());
}

// ── The suppliers ────────────────────────────────────────────────

const SUPPLIERS = {
  slap: {
    number: "101",
    name: "Lunds Släp & Maskin AB",
    address: "Industrigatan 12, 222 38 Lund",
    orgNo: "556123-4567",
    bankgiro: "5050-1055",
  },
  tryck: {
    number: "102",
    name: "Tryckeriet i Lund AB",
    address: "Bredgatan 4, 222 21 Lund",
    orgNo: "556234-5678",
    bankgiro: "5432-1098",
  },
  dryck: {
    number: "103",
    name: "Skånska Dryckesgrossisten AB",
    address: "Hamngatan 9, 211 22 Malmö",
    orgNo: "556345-6789",
    bankgiro: "5678-1234",
  },
  el: {
    number: "104",
    name: "Kraftringen Energi AB",
    address: "Box 25, 221 00 Lund",
    orgNo: "556896-5654",
    bankgiro: "5103-5536",
  },
  ljud: {
    number: "105",
    name: "Öresunds Ljud & Ljus HB",
    address: "Kalendegatan 20, 211 35 Malmö",
    orgNo: "969712-3456",
    bankgiro: "5811-2233",
  },
  buss: {
    number: "106",
    name: "Bergkvarabuss AB",
    address: "Fältspatsgatan 2, 421 30 Västra Frölunda",
    orgNo: "556078-1234",
    bankgiro: "5266-7788",
  },
} as const;

type SupplierKey = keyof typeof SUPPLIERS;

// ── The seed ─────────────────────────────────────────────────────

export interface SeedInvoicesCtx {
  prisma: PrismaClient;
  /** YYYY-MM-DD, Stockholm. */
  today: string;
  userId: (name: string) => string;
  resultUnitId: (name: string) => string;
  /** The first cost centre of a unit, with a cost account the budget has on it. */
  costCenterOf: (unit: string) => { id: string; code: string; account: string };
}

export async function seedSupplierInvoices(ctx: SeedInvoicesCtx) {
  const { prisma, today, userId, resultUnitId, costCenterOf } = ctx;
  const year = Number(today.slice(0, 4));
  const day = (offset: number) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const at = (offset: number, time: string) => new Date(`${day(offset)}T${time}:00+01:00`);
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`);

  const treasurer = userId("Maja Holm");
  const klara = userId("Klara Ström");
  const oskar = userId("Oskar Berg");
  const elsa = userId("Elsa Lindqvist");

  // The register a kontering picks from, as the last read of Fortnox's left it.
  for (const s of Object.values(SUPPLIERS)) {
    const row = { name: s.name, orgNo: s.orgNo, bankgiro: s.bankgiro, active: true };
    await prisma.supplier.upsert({
      where: { number: s.number },
      create: { number: s.number, ...row },
      update: row,
    });
  }
  // Read back as the scan's match reads it (lib/server/supplier-register.ts, supplierMatcher).
  const register = await prisma.supplier.findMany();

  let pdfs = 0;
  async function storeDocument(opts: {
    filename: string;
    bytes: Buffer;
    createdAt: Date;
    invoiceId?: string;
    position?: number;
    inboundMailId?: string | null;
    uploadedById?: string | null;
    returnedFrom?: string;
    returnNote?: string;
  }) {
    const id = randomUUID();
    // The inbox key, as every document arriving gets one and keeps it on its invoice.
    const objectKey = `supplier-invoices/inbox/${id}-${opts.filename}`;
    await putObject(objectKey, opts.bytes, "application/pdf");
    pdfs++;
    await prisma.supplierInvoiceDocument.create({
      data: {
        id,
        objectKey,
        filename: opts.filename,
        mimeType: "application/pdf",
        byteSize: opts.bytes.length,
        invoiceId: opts.invoiceId ?? null,
        position: opts.position ?? 0,
        inboundMailId: opts.inboundMailId ?? null,
        uploadedById: opts.uploadedById ?? null,
        returnedFrom: opts.returnedFrom ?? null,
        returnNote: opts.returnNote ?? null,
        createdAt: opts.createdAt,
      },
    });
  }

  /** A mail as it is kept after intake: the forwarder's note on top, and the forwarded supplier mail under it. */
  async function mail(opts: {
    from: { id: string | null; name: string; address: string };
    subject: string;
    note: string | null;
    forwarded: { from: string; date: string; subject: string; text: string } | null;
    receivedAt: Date;
    /** False for a mail from before the text was kept. */
    keepBody?: boolean;
  }) {
    const quoted = opts.forwarded
      ? [
          "---------- Forwarded message ---------",
          `From: ${opts.forwarded.from}`,
          `Date: ${opts.forwarded.date}`,
          `Subject: ${opts.forwarded.subject}`,
          `To: ${opts.from.address}`,
          "",
          opts.forwarded.text,
        ].join("\n")
      : "";
    const body = [opts.note, quoted].filter(Boolean).join("\n\n");
    const row = await prisma.inboundMail.create({
      data: {
        gmailId: `seed-${randomUUID()}`,
        messageId: `<${randomUUID()}@mail.gmail.com>`,
        fromAddress: opts.from.address,
        fromName: opts.from.name,
        senderId: opts.from.id,
        subject: opts.subject,
        note: opts.note,
        originalFrom: opts.forwarded?.from.match(/<([^>]+)>/)?.[1] ?? null,
        body: opts.keepBody === false ? null : body || null,
        status: "ACCEPTED",
        receivedAt: opts.receivedAt,
        createdAt: opts.receivedAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  const member = (name: string) => ({
    id: userId(name),
    name,
    address: `${name.toLowerCase().replace(/å|ä/g, "a").replace(/ö/g, "o").replace(/\s+/g, ".")}@user.dsek.se`,
  });

  const invoicePdf = (supplier: SupplierKey, spec: Omit<InvoicePdf, "supplier">): InvoicePdf => ({
    supplier: SUPPLIERS[supplier],
    ...spec,
  });

  // ── The Inkorg ─────────────────────────────────────────────────

  // A forwarded mail with the supplier's own text under the note. Nothing in the note says whose it is.
  {
    const pdf = invoicePdf("slap", {
      invoiceNumber: "20417",
      invoiceDate: day(-6),
      dueDate: day(24),
      ocr: withCheckDigit("204170073"),
      lines: [
        { text: "Hyra kylsläp 2 dygn", amount: 1800 },
        { text: "Utkörning och hämtning", amount: 450 },
      ],
    });
    const mailId = await mail({
      from: member("Elsa Lindqvist"),
      subject: "Fwd: Faktura 20417 från Lunds Släp & Maskin",
      note: "Hej! Den här kom till mig, det är kylsläpet vi hyrde till nollningsavslutningen. Vet inte vilket utskott som ska ta den.",
      forwarded: {
        from: "Lunds Släp & Maskin AB <faktura@lundsslap.se>",
        date: `${day(-6)} 09:12`,
        subject: "Faktura 20417",
        text: [
          "Hej,",
          "",
          "Bifogat finner ni faktura 20417 avseende hyra av kylsläp 2 dygn samt utkörning.",
          "",
          "Vänligen betala till bankgiro 5050-1055 och ange OCR 2041700731.",
          "Vid frågor om fakturan, svara på detta mejl eller ring 046-12 34 56.",
          "",
          "Med vänliga hälsningar",
          "Annika Persson",
          "Lunds Släp & Maskin AB",
          "Industrigatan 12, 222 38 Lund",
        ].join("\n"),
      },
      receivedAt: at(-5, "10:24"),
    });
    await storeDocument({
      filename: "Faktura_20417.pdf",
      bytes: await renderInvoice(pdf),
      createdAt: at(-5, "10:24"),
      inboundMailId: mailId,
      uploadedById: elsa,
    });
  }

  // An invoice and its specification in one mail, so two documents in the Inkorg from the same mail.
  {
    const pdf = invoicePdf("dryck", {
      invoiceNumber: "F-88213",
      invoiceDate: day(-3),
      dueDate: day(27),
      ocr: withCheckDigit("882130045"),
      reference: "SEX01",
      lines: [
        { text: "Dryck enligt specifikation", amount: 6240 },
        { text: "Pant", amount: 312 },
        { text: "Leveransavgift", amount: 395 },
      ],
    });
    const mailId = await mail({
      from: member("Klara Ström"),
      subject: "Fwd: Faktura F-88213 och följesedel",
      note: "Faktura och spec för gasquen 14/11. Specen är bara underlag, fakturan är den första PDF:en.",
      forwarded: {
        from: "Skånska Dryckesgrossisten <ekonomi@skanskadryck.se>",
        date: `${day(-3)} 14:02`,
        subject: "Faktura F-88213",
        text: [
          "Hej Klara!",
          "",
          "Tack för beställningen. Här kommer faktura och följesedel för leveransen till Kårhuset.",
          "Returpanten krediteras på nästa faktura när backarna har hämtats.",
          "",
          "Hälsningar",
          "Ekonomiavdelningen, Skånska Dryckesgrossisten AB",
        ].join("\n"),
      },
      receivedAt: at(-2, "16:47"),
    });
    await storeDocument({
      filename: "Faktura_F-88213.pdf",
      bytes: await renderInvoice(pdf),
      createdAt: at(-2, "16:47"),
      inboundMailId: mailId,
      uploadedById: klara,
    });
    await storeDocument({
      filename: "Foljesedel_F-88213.pdf",
      bytes: await renderSpecification("Följesedel F-88213", [
        ["Lättöl 33 cl, flak 24", "12 st"],
        ["Cider 33 cl, flak 24", "8 st"],
        ["Läsk 33 cl, flak 24", "6 st"],
        ["Mineralvatten 50 cl, flak 24", "4 st"],
      ]),
      createdAt: at(-2, "16:47"),
      inboundMailId: mailId,
      uploadedById: klara,
    });
  }

  // Put in by hand: no mail, so there is nothing to switch to beside the PDF.
  {
    const pdf = invoicePdf("el", {
      invoiceNumber: "7734002918",
      invoiceDate: day(-4),
      dueDate: day(16),
      ocr: withCheckDigit("7734002918"),
      lines: [
        { text: "Elnät oktober, Kårhuset kök", amount: 1340.5 },
        { text: "Elhandel oktober", amount: 2215.25 },
      ],
    });
    await storeDocument({
      filename: "Elfaktura oktober.pdf",
      bytes: await renderInvoice(pdf),
      createdAt: at(-1, "09:05"),
      uploadedById: treasurer,
    });
  }

  // From before the mail's text was kept: only the note. And a note long enough to need "Visa mer".
  {
    const pdf = invoicePdf("ljud", {
      invoiceNumber: "2026-118",
      invoiceDate: day(-12),
      dueDate: day(2),
      ocr: withCheckDigit("2026118"),
      lines: [
        { text: "Hyra PA-system, helg", amount: 3900 },
        { text: "Ljustekniker 6 h", amount: 2700 },
      ],
    });
    const mailId = await mail({
      from: member("Oskar Berg"),
      subject: "Fwd: Faktura 2026-118",
      note: [
        "Hej skattmästeriet!",
        "Det här är ljudet till arbetsmarknadsdagarnas mingel, men en del av det användes också av Infoutskottet för filmningen på kvällen.",
        "Jag tror att Näringslivsutskottet ska ta det mesta, men vi har inte bestämt hur den ska delas.",
        "Kan ni skicka den till oss så delar vi upp den när vi har pratat med Info?",
      ].join(" "),
      forwarded: null,
      receivedAt: at(-11, "21:30"),
      keepBody: false,
    });
    await storeDocument({
      filename: "faktura-2026-118.pdf",
      bytes: await renderInvoice(pdf),
      createdAt: at(-11, "21:30"),
      inboundMailId: mailId,
      uploadedById: oskar,
    });
  }

  // Sent back by a unit, with a reason too long for two lines.
  {
    const pdf = invoicePdf("tryck", {
      invoiceNumber: "31882",
      invoiceDate: day(-9),
      dueDate: day(6),
      ocr: withCheckDigit("318820001"),
      lines: [
        { text: "Affischer A2, 4-färg, 60 st", amount: 1680 },
        { text: "Flyers A6, 500 st", amount: 640 },
      ],
    });
    const mailId = await mail({
      from: member("Elsa Lindqvist"),
      subject: "Fwd: Faktura 31882 Tryckeriet",
      note: "Affischerna, tror det var Infoutskottet som beställde dem?",
      forwarded: {
        from: "Tryckeriet i Lund <order@tryckerietlund.se>",
        date: `${day(-9)} 11:40`,
        subject: "Faktura 31882",
        text: "Hej,\n\nHär kommer fakturan för affischerna och flyersen som hämtades i fredags.\n\nMvh\nTryckeriet i Lund",
      },
      receivedAt: at(-8, "12:15"),
    });
    await storeDocument({
      filename: "Faktura 31882.pdf",
      bytes: await renderInvoice(pdf),
      createdAt: at(-8, "12:15"),
      inboundMailId: mailId,
      uploadedById: elsa,
      returnedFrom: "Infoutskottet",
      returnNote:
        "Det här är inte vårt, vi har inte beställt några tryckta affischer den här terminen. Kolla med Sexmästeriet, de pratade om affischer till gasquen i december. Om det inte är deras kanske det är Aktivitetsutskottet, som hade flyers till pubrundan.",
    });
  }

  // Refused mail, listed at the foot of the Inkorg: a supplier writing straight to the mailbox, and one with no PDF.
  await prisma.inboundMail.createMany({
    data: [
      {
        gmailId: `seed-${randomUUID()}`,
        fromAddress: "faktura@lundsslap.se",
        fromName: "Lunds Släp & Maskin AB",
        subject: "Påminnelse faktura 20311",
        status: "REJECTED",
        rejectReason: "foreignDomain",
        receivedAt: at(-4, "07:58"),
        createdAt: at(-4, "07:58"),
      },
      {
        gmailId: `seed-${randomUUID()}`,
        fromAddress: member("Oskar Berg").address,
        fromName: "Oskar Berg",
        senderId: oskar,
        subject: "Fwd: Er faktura finns nu tillgänglig",
        note: "Fakturan finns bara som länk, kan ni hämta den?",
        status: "REJECTED",
        rejectReason: "noPdf",
        receivedAt: at(-1, "18:20"),
        createdAt: at(-1, "18:20"),
      },
    ],
  });

  // ── Fakturor ───────────────────────────────────────────────────

  let counter = 0;
  const events: {
    invoiceId: string;
    type: SupplierInvoiceEventType;
    actorId: string | null;
    comment?: string;
    diff?: object;
    createdAt: Date;
  }[] = [];

  interface Row {
    unit: string;
    /** SEK. Left out on a single row, which is the whole of it. */
    amount?: number;
    signedBy?: string;
    signedAt?: Date;
  }

  async function invoice(opts: {
    supplier: SupplierKey;
    pdf: Omit<InvoicePdf, "supplier">;
    status:
      "ASSIGNED" | "PENDING_APPROVAL" | "CHANGES_REQUESTED" | "APPROVED" | "BOOKED" | "EXPORTED";
    unit: string;
    /** Days ago it arrived, and was given to the unit. */
    arrived: number;
    assigned: number;
    assignedBy: string | null;
    /** Who forwarded it, or who uploaded it. */
    from: string;
    mailed?: { subject: string; note: string | null; text: string };
    /** Due date triage gave when it was given, before anybody fördelade it. */
    triageDue?: boolean;
    /** What the unit wrote, and the split, once fördelad. */
    description?: string;
    rows?: Row[];
    fordeladAt?: number;
    changes?: { by: string; comment: string; at: number };
    bookedAt?: number;
    exportedAt?: number;
  }) {
    const pdf = invoicePdf(opts.supplier, opts.pdf);
    const s = SUPPLIERS[opts.supplier];
    const id = randomUUID();
    const reference = formatReference(year, ++counter, "LEV");
    const received = at(-opts.arrived, "10:00");
    const assignedAt = at(-opts.assigned, "13:30");
    const amountOre = Math.round(total(pdf) * 100);
    const fordelad = opts.rows !== undefined;
    const booked = opts.status === "BOOKED" || opts.status === "EXPORTED";
    // The supplier as the fördelning's scan finds it (lib/server/invoice-prefill.ts): the PDF gives the org nr and the
    // bankgiro, and the name and number come from the register they match. Never a name off the PDF itself.
    const known = matchSupplier({ supplierOrgNo: s.orgNo, bankgiro: s.bankgiro }, register);

    const mailId = opts.mailed
      ? await mail({
          from: member(opts.from),
          subject: opts.mailed.subject,
          note: opts.mailed.note,
          forwarded: {
            from: `${s.name} <faktura@${s.name.split(" ")[0].toLowerCase()}.se>`,
            date: `${day(-opts.arrived - 1)} 15:00`,
            subject: `Faktura ${pdf.invoiceNumber}`,
            text: opts.mailed.text,
          },
          receivedAt: received,
        })
      : null;

    await prisma.supplierInvoice.create({
      data: {
        id,
        reference,
        status: opts.status,
        source: mailId ? "EMAIL" : "UPLOAD",
        receivedById: userId(opts.from),
        inboundMailId: mailId,
        resultUnitId: resultUnitId(opts.unit),
        assignedById: opts.assignedBy ? userId(opts.assignedBy) : null,
        assignedAt,
        description: opts.description ?? null,
        // What the unit confirmed at the fördelning, or what triage gave when it was given.
        amount: fordelad ? amountOre : null,
        dueDate: fordelad || opts.triageDue ? date(pdf.dueDate) : null,
        // Read off the PDF at the fördelning, for the treasury to check.
        ...(fordelad && {
          invoiceDate: date(pdf.invoiceDate),
          invoiceNumber: pdf.invoiceNumber,
          ocr: pdf.ocr,
          bankgiro: s.bankgiro,
          supplierOrgNo: s.orgNo,
          yourReference: pdf.reference ?? null,
          ...(known && { supplierName: known.name, fortnoxSupplierNumber: known.number }),
          prefilled: booked
            ? []
            : [
                "invoiceDate",
                "invoiceNumber",
                "ocr",
                "bankgiro",
                "supplierOrgNo",
                ...(known ? ["supplierName"] : []),
              ],
        }),
        // Picked at kontering when the scan found none.
        ...(booked && { supplierName: s.name, fortnoxSupplierNumber: s.number }),
        ...(opts.status === "EXPORTED" && {
          fortnoxGivenNumber: String(400 + counter),
          exportedAt: at(-(opts.exportedAt ?? 0), "15:10"),
          exportedById: treasurer,
        }),
        createdAt: assignedAt,
      },
    });

    await storeDocument({
      filename: `Faktura_${pdf.invoiceNumber}.pdf`,
      bytes: await renderInvoice(pdf),
      createdAt: received,
      invoiceId: id,
      inboundMailId: mailId,
      uploadedById: userId(opts.from),
    });

    events.push(
      { invoiceId: id, type: "RECEIVED", actorId: userId(opts.from), createdAt: received },
      {
        invoiceId: id,
        type: "ASSIGNED",
        actorId: opts.assignedBy ? userId(opts.assignedBy) : null,
        diff: { from: null, to: opts.unit },
        createdAt: assignedAt,
      },
    );

    if (!opts.rows) return id;
    const split = opts.rows.length > 1;
    const fordeladAt = at(-(opts.fordeladAt ?? 0), "19:45");
    for (const [position, r] of opts.rows.entries()) {
      const cc = costCenterOf(r.unit);
      await prisma.supplierInvoiceAllocation.create({
        data: {
          invoiceId: id,
          costCenterId: cc.id,
          amount: split && r.amount !== undefined ? Math.round(r.amount * 100) : null,
          approvedById: r.signedBy ? userId(r.signedBy) : null,
          approvedAt: r.signedBy ? (r.signedAt ?? fordeladAt) : null,
          position,
        },
      });
    }
    const signedAtFordelning = opts.rows
      .filter((r) => r.signedBy && !r.signedAt)
      .map((r) => costCenterOf(r.unit).code);
    if (signedAtFordelning.length)
      events.push({
        invoiceId: id,
        type: "COST_CENTER_APPROVED",
        actorId: userId(opts.rows.find((r) => r.signedBy && !r.signedAt)!.signedBy!),
        diff: { costCenters: signedAtFordelning },
        createdAt: fordeladAt,
      });
    for (const r of opts.rows.filter((r) => r.signedBy && r.signedAt))
      events.push({
        invoiceId: id,
        type: "COST_CENTER_APPROVED",
        actorId: userId(r.signedBy!),
        diff: { costCenters: [costCenterOf(r.unit).code] },
        createdAt: r.signedAt!,
      });
    if (opts.changes)
      events.push({
        invoiceId: id,
        type: "CHANGES_REQUESTED",
        actorId: userId(opts.changes.by),
        comment: opts.changes.comment,
        createdAt: at(-opts.changes.at, "08:30"),
      });
    if (["APPROVED", "BOOKED", "EXPORTED"].includes(opts.status)) {
      const last = Math.max(...opts.rows.map((r) => (r.signedAt ?? fordeladAt).getTime()));
      events.push({ invoiceId: id, type: "APPROVED", actorId: null, createdAt: new Date(last) });
    }

    if (booked) {
      // The kontering: one debit line per attested row, on a cost account the cost centre budgets.
      const lines = opts.rows.map((r, position) => {
        const cc = costCenterOf(r.unit);
        const ore = split ? Math.round((r.amount ?? 0) * 100) : amountOre;
        return {
          invoiceId: id,
          position,
          account: cc.account,
          costCenterCode: cc.code,
          description: opts.description ?? null,
          debit: ore,
        };
      });
      await prisma.supplierInvoiceLine.createMany({ data: lines });
      events.push({
        invoiceId: id,
        type: "BOOKED",
        actorId: treasurer,
        createdAt: at(-(opts.bookedAt ?? 0), "11:20"),
      });
    }
    if (opts.status === "EXPORTED")
      events.push({
        invoiceId: id,
        type: "EXPORTED",
        actorId: treasurer,
        comment: String(400 + counter),
        createdAt: at(-(opts.exportedAt ?? 0), "15:10"),
      });
    return id;
  }

  const forwardText = (who: string) =>
    `Hej,\n\nBifogat finner ni fakturan. Betalning sker till bankgiro enligt fakturan.\n\nMed vänliga hälsningar\n${who}`;

  // Just given to Oskar Berg's units: Att attestera for the RESULTATANSVARIG sign-in, one nearly due.
  await invoice({
    supplier: "buss",
    pdf: {
      invoiceNumber: "B-55120",
      invoiceDate: day(-7),
      dueDate: day(3),
      ocr: withCheckDigit("551200088"),
      lines: [{ text: "Bussresa Lund-Göteborg t/r, företagsbesök", amount: 9800 }],
    },
    status: "ASSIGNED",
    unit: "Näringslivsutskottet",
    arrived: 4,
    assigned: 3,
    assignedBy: "Maja Holm",
    from: "Maja Holm",
    triageDue: true,
  });
  await invoice({
    supplier: "tryck",
    pdf: {
      invoiceNumber: "31790",
      invoiceDate: day(-20),
      dueDate: day(-2),
      ocr: withCheckDigit("317900012"),
      lines: [{ text: "Roll-up, 2 st", amount: 2390 }],
    },
    status: "ASSIGNED",
    unit: "Infoutskottet",
    arrived: 15,
    assigned: 14,
    assignedBy: "Ludwig Gehlsdorf",
    from: "Elsa Lindqvist",
    mailed: {
      subject: "Fwd: Faktura 31790",
      note: "Roll-upsen till infodagen!",
      text: forwardText("Tryckeriet i Lund"),
    },
    triageDue: true,
  });
  // Given automatically: the forwarder's note named the cost centre.
  await invoice({
    supplier: "dryck",
    pdf: {
      invoiceNumber: "F-88190",
      invoiceDate: day(-2),
      dueDate: day(28),
      ocr: withCheckDigit("881900033"),
      reference: "SEX01",
      lines: [{ text: "Dryck sittning 7/11", amount: 4420 }],
    },
    status: "ASSIGNED",
    unit: "Sexmästeriet",
    arrived: 1,
    assigned: 1,
    assignedBy: null,
    from: "Klara Ström",
    mailed: {
      subject: "Fwd: Faktura F-88190",
      note: "SEX01, sittningen förra veckan",
      text: forwardText("Skånska Dryckesgrossisten AB"),
    },
  });

  // Split with another unit: Sexmästeriet signed its share, Infoutskottet (Oskar Berg) has its own to sign.
  await invoice({
    supplier: "ljud",
    pdf: {
      invoiceNumber: "2026-104",
      invoiceDate: day(-10),
      dueDate: day(10),
      ocr: withCheckDigit("2026104"),
      lines: [
        { text: "Ljud och ljus, gasque", amount: 5200 },
        { text: "Filmutrustning", amount: 1800 },
      ],
    },
    status: "PENDING_APPROVAL",
    unit: "Sexmästeriet",
    arrived: 8,
    assigned: 7,
    assignedBy: "Maja Holm",
    from: "Klara Ström",
    mailed: {
      subject: "Fwd: Faktura 2026-104",
      note: null,
      text: forwardText("Öresunds Ljud & Ljus HB"),
    },
    description: "Ljud till gasquen och filmning för Info",
    rows: [
      { unit: "Sexmästeriet", amount: 5200, signedBy: "Klara Ström" },
      { unit: "Infoutskottet", amount: 1800 },
    ],
    fordeladAt: 5,
  });

  // Back with Oskar Berg: the other unit said its share was not theirs, and every signature came off.
  await invoice({
    supplier: "slap",
    pdf: {
      invoiceNumber: "20388",
      invoiceDate: day(-14),
      dueDate: day(8),
      ocr: withCheckDigit("203880051"),
      lines: [{ text: "Hyra släp 1 dygn", amount: 950 }],
    },
    status: "CHANGES_REQUESTED",
    unit: "Näringslivsutskottet",
    arrived: 12,
    assigned: 11,
    assignedBy: "Maja Holm",
    from: "Oskar Berg",
    mailed: {
      subject: "Fwd: Faktura 20388",
      note: null,
      text: forwardText("Lunds Släp & Maskin AB"),
    },
    description: "Släp till mässan",
    rows: [
      { unit: "Näringslivsutskottet", amount: 500 },
      { unit: "Aktivitetsutskottet", amount: 450 },
    ],
    fordeladAt: 9,
    changes: {
      by: "Klara Ström",
      comment: "Vi använde inte släpet, det var bara ARKAD-montern. Ta hela på er.",
      at: 2,
    },
  });

  // Attested, waiting for the treasury's kontering.
  await invoice({
    supplier: "dryck",
    pdf: {
      invoiceNumber: "F-87951",
      invoiceDate: day(-16),
      dueDate: day(5),
      ocr: withCheckDigit("879510027"),
      reference: "AKTU",
      lines: [{ text: "Läsk och snacks, spelkväll", amount: 1875 }],
    },
    status: "APPROVED",
    unit: "Aktivitetsutskottet",
    arrived: 14,
    assigned: 13,
    assignedBy: "Maja Holm",
    from: "Klara Ström",
    mailed: {
      subject: "Fwd: Faktura F-87951",
      note: null,
      text: forwardText("Skånska Dryckesgrossisten AB"),
    },
    description: "Spelkväll i november",
    rows: [{ unit: "Aktivitetsutskottet", signedBy: "Klara Ström" }],
    fordeladAt: 10,
  });

  // Konterad, waiting to be sent to Fortnox.
  await invoice({
    supplier: "buss",
    pdf: {
      invoiceNumber: "B-54877",
      invoiceDate: day(-25),
      dueDate: day(1),
      ocr: withCheckDigit("548770041"),
      lines: [{ text: "Bussresa studiebesök Malmö", amount: 4350 }],
    },
    status: "BOOKED",
    unit: "Näringslivsutskottet",
    arrived: 22,
    assigned: 21,
    assignedBy: "Maja Holm",
    from: "Maja Holm",
    description: "Studiebesök hos Axis",
    rows: [{ unit: "Näringslivsutskottet", signedBy: "Oskar Berg" }],
    fordeladAt: 19,
    bookedAt: 2,
  });

  // In Fortnox.
  await invoice({
    supplier: "el",
    pdf: {
      invoiceNumber: "7733981144",
      invoiceDate: day(-40),
      dueDate: day(-10),
      ocr: withCheckDigit("7733981144"),
      lines: [{ text: "El september, Kårhuset kök", amount: 2980 }],
    },
    status: "EXPORTED",
    unit: "Sexmästeriet",
    arrived: 38,
    assigned: 37,
    assignedBy: "Maja Holm",
    from: "Maja Holm",
    description: "El september",
    rows: [{ unit: "Sexmästeriet", signedBy: "Klara Ström" }],
    fordeladAt: 35,
    bookedAt: 30,
    exportedAt: 30,
  });

  await prisma.supplierInvoiceEvent.createMany({ data: events });

  return {
    invoices: counter,
    inboxDocuments: await prisma.supplierInvoiceDocument.count({ where: { invoiceId: null } }),
    pdfs,
  };
}
