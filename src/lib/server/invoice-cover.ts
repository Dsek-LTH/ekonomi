// The attest page that goes to Fortnox in front of a levfaktura's PDF: who attested each row and when, and who
// konterade and sent it. The utläggsräkning's counterpart, typeset the same way (invoice-cover/invoice-cover.typ),
// then stapled by lib/server/pdf-merge.ts.
import "server-only";

import path from "node:path";

import { prisma } from "@/lib/server/db";
import { typeset } from "@/lib/server/typst";
import { isoDate } from "@/lib/data/shared";
import type { LoadedInvoice } from "@/lib/api/supplier-invoice-access";
import { buildInvoiceCoverData, type CoverFacts } from "@/lib/ui/invoice-cover";

export {
  buildInvoiceCoverData,
  type CoverFacts,
  type InvoiceCoverData,
} from "@/lib/ui/invoice-cover";

const TEMPLATE = path.join(process.cwd(), "src/lib/server/invoice-cover/invoice-cover.typ");

/**
 * What the page says about this invoice, for both the export and the panel. The export passes what it knows
 * better: the supplier's name as Fortnox has it, and the treasurer sending it.
 */
export async function invoiceCoverFacts(
  invoice: LoadedInvoice,
  sending?: { supplierName: string; exportedBy: string },
): Promise<CoverFacts> {
  const [users, booked, exporter] = await Promise.all([
    prisma.user.findMany({
      where: {
        id: {
          in: invoice.allocations.flatMap((a) => (a.approvedById ? [a.approvedById] : [])),
        },
      },
      select: { id: true, name: true },
    }),
    // Who konterade it: the last time, if done more than once.
    prisma.supplierInvoiceEvent.findFirst({
      where: { invoiceId: invoice.id, type: "BOOKED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, actor: { select: { name: true } } },
    }),
    !sending && invoice.exportedById
      ? prisma.user.findUnique({
          where: { id: invoice.exportedById },
          select: { name: true },
        })
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
    // A single row is the whole invoice; a split names its shares.
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
