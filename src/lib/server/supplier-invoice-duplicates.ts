// Is this levfaktura already here, or already in Fortnox? The same supplier's invoice number twice is one invoice
// mailed twice (or forwarded by two people). Asked at kontering, which is refused while either is true: the copy is
// deleted instead. The export still links to one it finds in Fortnox, for an answer lost on the way back.
import "server-only";

import { prisma } from "@/lib/server/db";
import { findSupplierInvoice, getServiceToken } from "@/lib/fortnox";
import type { InvoiceDuplicates } from "@/lib/domain/supplier-invoice";

export { duplicateBlocker, type InvoiceDuplicates } from "@/lib/domain/supplier-invoice";

export async function findInvoiceDuplicates(
  invoiceId: string,
  supplierNumber: string,
  invoiceNumber: string,
): Promise<InvoiceDuplicates> {
  const number = invoiceNumber.trim();
  const [local, fortnox] = await Promise.all([
    prisma.supplierInvoice.findFirst({
      where: {
        id: { not: invoiceId },
        fortnoxSupplierNumber: supplierNumber,
        invoiceNumber: { equals: number, mode: "insensitive" },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, reference: true, status: true },
    }),
    getServiceToken()
      .then((token) => findSupplierInvoice(token, supplierNumber, number))
      .then(
        (given) => ({ given, checked: true }),
        (e) => {
          console.warn(`[supplier-invoices] ${invoiceId}: could not look for a copy in Fortnox`, e);
          return { given: null, checked: false };
        },
      ),
  ]);
  return { local, fortnox: fortnox.given, fortnoxChecked: fortnox.checked };
}
