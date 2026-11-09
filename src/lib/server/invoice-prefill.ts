// Filling a levfaktura's fields from its PDF. The PDF is read once on arrival and kept on the document
// (SupplierInvoiceDocument.scan). Only into empty fields: what was read is recorded in `prefilled` so the
// page can mark it for the treasurer to check.
import "server-only";

import { parseInvoiceText, type InvoiceTextFields } from "@/lib/domain/invoice-text";
import { isoToDate } from "@/lib/domain/date";
import { SECTION } from "@/lib/contract/section";
import { pdfLines } from "./pdf-text";
import type { KnownSupplier } from "./supplier-register";

/** The fields the text of this PDF gives, or none for anything else. */
export async function readInvoicePdf(
  bytes: Uint8Array,
  mimeType: string,
): Promise<InvoiceTextFields> {
  if (mimeType !== "application/pdf") return {};
  return parseInvoiceText(await pdfLines(bytes), { ownOrgNo: SECTION.orgNo });
}

/** The invoice columns a prefill can write, and what each is called in `prefilled`. */
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

type Current = Partial<
  Record<(typeof COLUMNS)[keyof typeof COLUMNS] | "supplierName" | "fortnoxSupplierNumber", unknown>
> & {
  prefilled?: string[];
};

/**
 * The write that fills what `current` lacks from `fields`, to spread into a create or update, with
 * `prefilled` extended. Empty when there is nothing to fill. `supplier` is the register's match for the scan
 * (supplierMatcher); the name counts as read off the PDF, being only as right as the number it matched by.
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
    data[column] =
      field === "dueDate" || field === "invoiceDate" ? isoToDate(value as string) : value;
    filled.push(column);
  }
  if (supplier && current.supplierName == null) {
    data.supplierName = supplier.name;
    filled.push("supplierName");
  }
  if (supplier && current.fortnoxSupplierNumber == null)
    data.fortnoxSupplierNumber = supplier.number;
  if (Object.keys(data).length === 0) return {};
  return filled.length
    ? { ...data, prefilled: [...new Set([...(current.prefilled ?? []), ...filled])] }
    : data;
}
