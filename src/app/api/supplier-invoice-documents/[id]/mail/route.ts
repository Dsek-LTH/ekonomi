// The mail a document in the Inkorg came in, read in the panel when somebody switches to it.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { gate } from "@/lib/api/guard";
import { loadInboxDocumentFor } from "@/lib/api/supplier-invoice-access";

// GET /api/supplier-invoice-documents/:id/mail -> { body } (null for an upload, or a mail whose text was not kept)
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInboxDocumentFor(g.actor, id);
  if (!access.ok) return access.res;

  const doc = await prisma.supplierInvoiceDocument.findUnique({
    where: { id },
    select: { inboundMail: { select: { body: true } } },
  });
  return NextResponse.json(
    { body: doc?.inboundMail?.body ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
