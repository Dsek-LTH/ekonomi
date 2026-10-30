// Filling a levfaktura's fields from its PDF. Where the three ways a PDF
// arrives (a hand upload, a forwarded mail, a document added later) all end up.
//
// The PDF is read once, when it arrives, and what it said is kept on the
// document (SupplierInvoiceDocument.scan). Making an invoice from it later
// fills from that.
//
// Only ever into empty fields. A value somebody typed is never replaced by one
// read off a page, and what was read is recorded in `prefilled`, so the page
// can mark it and the treasurer knows what to check before export.
import "server-only";

import { parseInvoiceText, type InvoiceTextFields } from "@/lib/domain/invoice-text";
import { isoToDate } from "@/lib/domain/date";
import { SECTION } from "@/lib/contract/section";
import { pdfLines } from "./pdf-text";
import type { KnownSupplier } from "./supplier-register";

/** The fields the text of this PDF gives, or none for anything else. */
export async function readInvoicePdf(bytes: Uint8Array, mimeType: string): Promise<InvoiceTextFields> {
  if (mimeType !== "application/pdf") return {};
  return parseInvoiceText(await pdfLines(bytes), { ownOrgNo: SECTION.orgNo });
}

/** The invoice columns a prefill can write, and what each is called in
 *  `prefilled`. */
const COLUMNS = {
  amount: "amount",
  dueDate: "dueDate",
  invoiceDate: "invoiceDate",
  invoiceNumber: "invoiceNumber",
  ocr: "ocr",
  bankgiro: "bankgiro",
  plusgiro: "plusgiro",
  supplierOrgNo: "supplierOrgNo",
  reference: "yourReference",
} as const satisfies Record<keyof InvoiceTextFields, string>;

type Current = Partial<Record<(typeof COLUMNS)[keyof typeof COLUMNS] | "supplierName" | "fortnoxSupplierNumber", unknown>> & {
  prefilled?: string[];
};

/**
 * The write that fills what `current` lacks from `fields`, ready to spread
 * into a create or an update, with `prefilled` extended to match. Empty when
 * there is nothing to fill.
 *
 * `supplier` is the register's match for the scan (supplierMatcher), which
 * names the supplier and picks it for the export step. The name counts as
 * read off the PDF, since it is only as right as the number it was matched by.
 */
export function prefillData(
  current: Current,
  fields: InvoiceTextFields,
  supplier?: KnownSupplier | null,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const filled: string[] = [];
  for (const [field, column] of Object.entries(COLUMNS) as [keyof InvoiceTextFields, string][]) {
    const value = fields[field];
    if (value === undefined || current[column as keyof Current] != null) continue;
    data[column] = field === "dueDate" || field === "invoiceDate" ? isoToDate(value as string) : value;
    filled.push(column);
  }
  if (supplier && current.supplierName == null) {
    data.supplierName = supplier.name;
    filled.push("supplierName");
  }
  if (supplier && current.fortnoxSupplierNumber == null) data.fortnoxSupplierNumber = supplier.number;
  if (Object.keys(data).length === 0) return {};
  return filled.length ? { ...data, prefilled: [...new Set([...(current.prefilled ?? []), ...filled])] } : data;
}
