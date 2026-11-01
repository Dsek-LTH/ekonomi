// The attest page that goes to Fortnox in front of a levfaktura's PDF: which
// invoice, who attested each row and when, and who konterade and sent it.
//
// The utläggsräkning's counterpart, and for the same reason: the invoice
// itself says what was bought, and this says who in the section agreed to pay
// for it. Fortnox keeps the two together with the supplier invoice, so the
// attest is part of the verifikat rather than something only this app knows.
//
// Typeset like the utläggsräkning, from a template drawn the same way
// (invoice-cover/invoice-cover.typ), so the two read as one family in Fortnox.
// pdf-lib then staples the invoice behind it (lib/server/pdf-merge.ts).
import "server-only";

import path from "node:path";

import { prisma } from "@/lib/server/db";
import { typeset } from "@/lib/server/typst";
import { isoDate } from "@/lib/data/shared";
import type { LoadedInvoice } from "@/lib/api/supplier-invoice-access";

const TEMPLATE = path.join(process.cwd(), "src/lib/server/invoice-cover/invoice-cover.typ");

export interface CoverFacts {
  /** "LEV26-0012". */
  reference: string;
  /** Null until the treasury has picked one, on a page shown before that. */
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number; // öre
  description: string | null;
  resultUnit: string | null;
  rows: {
    /** The code alone, as the utläggsräkning writes it. */
    costCenter: string;
    amount: number; // öre
    attestedBy: string | null;
    attestedAt: Date | null;
    comment: string | null;
  }[];
  /** Who konterade it, from its history. Null where the history has no one. */
  booking: { by: string | null; at: Date } | null;
  /** Null until it is sent. */
  exportedBy: string | null;
  /** The day the page is dated: the day it was sent, once it was. */
  created: Date;
}

/** What the template is handed: every value worded and formatted already. */
export interface InvoiceCoverData {
  reference: string;
  supplier: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  resultUnit: string | null;
  description: string | null;
  created: string;
  total: string;
  allocations: {
    costCenter: string;
    amount: string;
    comment: string | null;
    approvedBy: string | null;
    approvedAt: string | null;
  }[];
  booking: { by: string | null; at: string | null };
  exportedBy: string | null;
}

const nf = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** öre → "1 250,00 kr", as the utläggsräkning writes it. */
const kr = (ore: number) => `${nf.format(ore / 100)} kr`;

/** The day in Stockholm, as an ISO date. A signature at 00:30 is that day's. */
const day = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/** The page as the template draws it. Pure, so the wording can be tested
 *  without typesetting anything. */
export function buildInvoiceCoverData(f: CoverFacts): InvoiceCoverData {
  return {
    reference: f.reference,
    supplier: f.supplierName,
    invoiceNumber: f.invoiceNumber,
    invoiceDate: f.invoiceDate || null,
    dueDate: f.dueDate || null,
    resultUnit: f.resultUnit,
    description: f.description,
    created: day(f.created),
    // What the rows add up to, as on the utläggsräkning: this page is about
    // what was attested, and the export has already checked it is the amount.
    total: kr(f.rows.reduce((s, r) => s + r.amount, 0)),
    allocations: f.rows.map((r) => ({
      costCenter: r.costCenter,
      amount: kr(r.amount),
      comment: r.comment,
      approvedBy: r.attestedBy,
      approvedAt: r.attestedAt ? day(r.attestedAt) : null,
    })),
    booking: { by: f.booking?.by ?? null, at: f.booking ? day(f.booking.at) : null },
    exportedBy: f.exportedBy,
  };
}

/**
 * What the page says about this invoice, read from it and its history. One
 * function for the export and for the panel, so the page a reader checks is
 * the page Fortnox gets.
 *
 * The export passes what it knows better: the supplier's name as Fortnox's
 * register has it, and the treasurer who is sending it right now.
 */
export async function invoiceCoverFacts(
  invoice: LoadedInvoice,
  sending?: { supplierName: string; exportedBy: string },
): Promise<CoverFacts> {
  const [users, booked, exporter] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: invoice.allocations.flatMap((a) => (a.approvedById ? [a.approvedById] : [])) } },
      select: { id: true, name: true },
    }),
    // Who konterade it: the last time it was, if it was done more than once.
    prisma.supplierInvoiceEvent.findFirst({
      where: { invoiceId: invoice.id, type: "BOOKED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, actor: { select: { name: true } } },
    }),
    !sending && invoice.exportedById
      ? prisma.user.findUnique({ where: { id: invoice.exportedById }, select: { name: true } })
      : null,
  ]);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return {
    reference: invoice.reference ?? "-",
    supplierName: sending?.supplierName ?? invoice.supplierName,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: isoDate(invoice.invoiceDate),
    dueDate: isoDate(invoice.dueDate),
    amount: invoice.amount ?? 0,
    description: invoice.description,
    resultUnit: invoice.resultUnit?.name ?? null,
    // What each unit signed for: a single row is the whole invoice, a split
    // names its shares.
    rows: invoice.allocations.map((a) => ({
      costCenter: a.costCenter.code,
      amount: (invoice.allocations.length === 1 ? invoice.amount : a.amount) ?? 0,
      attestedBy: a.approvedById ? (nameOf.get(a.approvedById) ?? null) : null,
      attestedAt: a.approvedAt,
      comment: a.comment,
    })),
    booking: booked && { by: booked.actor?.name ?? null, at: booked.createdAt },
    exportedBy: sending?.exportedBy ?? exporter?.name ?? null,
    created: (!sending && invoice.exportedAt) || new Date(),
  };
}

export async function renderInvoiceCover(f: CoverFacts): Promise<Uint8Array> {
  return typeset(TEMPLATE, buildInvoiceCoverData(f), "the levfaktura cover page");
}
