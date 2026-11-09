// Serve a levfaktura's attest page, drawn per request from invoiceCoverFacts (as the export does)
// and never stored.
import { fail, gate } from "@/lib/api/guard";
import { loadInvoiceFor } from "@/lib/api/supplier-invoice-access";
import { invoiceCoverFacts, renderInvoiceCover } from "@/lib/server/invoice-cover";

// GET /api/supplier-invoices/:id/cover
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gate();
  if (!g.ok) return g.res;

  const access = await loadInvoiceFor(g.actor, id);
  if (!access.ok) return access.res;

  let cover: Uint8Array;
  try {
    cover = await renderInvoiceCover(await invoiceCoverFacts(access.invoice));
  } catch (e) {
    console.error(`[supplier-invoices] ${id}: the cover page could not be drawn`, e);
    return fail(502, "supplierInvoice.coverRenderFailed");
  }

  return new Response(new Uint8Array(cover), {
    headers: {
      "Content-Type": "application/pdf",
      // Drawn from signatures that are still coming in, so held briefly and
      // never written to disk.
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="attest-${access.invoice.reference ?? id}.pdf"`,
    },
  });
}
