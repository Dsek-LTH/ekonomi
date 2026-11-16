// The attest page's wording, shared by the server (the PDF that goes to Fortnox, lib/server/invoice-cover.ts) and
// the browser (the page drawn live while the treasurer konterar, components/typst). Both hand the template the same
// data, so what is shown while typing is what is sent.
import { formatOreKr } from "@/lib/ui/format";

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

/** The day in Stockholm, as an ISO date. A signature at 00:30 is that day's. */
const day = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

/** The page as the template draws it. Pure, so the wording can be tested. */
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
    // What the rows add up to, as on the utläggsräkning.
    total: formatOreKr(
      f.rows.reduce((s, r) => s + r.amount, 0),
      { decimals: 2 },
    ),
    allocations: f.rows.map((r) => ({
      costCenter: r.costCenter,
      amount: formatOreKr(r.amount, { decimals: 2 }),
      comment: r.comment,
      approvedBy: r.attestedBy,
      approvedAt: r.attestedAt ? day(r.attestedAt) : null,
    })),
    booking: { by: f.booking?.by ?? null, at: f.booking ? day(f.booking.at) : null },
    exportedBy: f.exportedBy,
  };
}

/** What the treasurer can change at kontering that the page shows. */
export interface CoverEdits {
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amount: number; // öre
}

/** The saved page with the kontering's unsaved values laid over it. A single row is the whole invoice, as in invoiceCoverFacts. */
export function liveCoverFacts(saved: CoverFacts, edits: CoverEdits): CoverFacts {
  return {
    ...saved,
    ...edits,
    rows: saved.rows.length === 1 ? [{ ...saved.rows[0], amount: edits.amount }] : saved.rows,
  };
}
