// Serve the utläggsräkning, the cover page naming who attested what, alone (the underlag is paged separately,
// lib/expense/document-url.ts, and stapled on only on the way to Fortnox, lib/server/pdf-merge.ts).
// A booked utlägg's stored cover is served, since those bytes went to Fortnox and must never be re-made.
// Anything not yet booked gets one drawn on the way past.
import { fail, gate } from "@/lib/api/guard";
import { denyExpenseView } from "@/lib/api/expense-access";
import { renderExpenseDocument, type DocumentFailure } from "@/lib/expense/document";
import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";

function documentFailure(failure: DocumentFailure) {
  switch (failure.reason) {
    case "expenseNotFound":
      return fail(404, "expense.notFound");
    case "renderFailed":
      return fail(502, "expense.coverRenderFailed", { values: { detail: failure.detail } });
    case "storeFailed":
      return fail(502, "expense.coverStoreFailed");
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate();
  if (!g.ok) return g.res;

  const expense = await prisma.expense.findUnique({
    where: { id },
    select: {
      id: true,
      submitterId: true,
      status: true,
      documentKey: true,
      documentFilename: true,
    },
  });
  if (!expense) return fail(404, "expense.notFound");

  // A cover is exactly as private as the utlägg it describes. Same gate as the receipts.
  const hidden = await denyExpenseView(g.actor, expense);
  if (hidden) return fail(404, "expense.notFound");

  // ── Stored once booked, drawn otherwise ──

  let cover: Uint8Array;
  let filename: string;
  if (expense.documentKey) {
    try {
      const obj = await getObjectBuffer(expense.documentKey);
      cover = new Uint8Array(obj.bytes);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") {
        console.error(`[expense] ${id}: cover object ${expense.documentKey} is gone`, e);
        return fail(404, "expense.documentMissing");
      }
      console.error(`[expense] ${id}: storage unreachable`, e);
      return fail(503, "expense.storageUnavailable");
    }
    filename = expense.documentFilename ?? "utlaggsrakning.pdf";
  } else {
    // A cover that will not draw is only the cover's problem: the underlag is still in the panel. Loud in the log.
    const rendered = await renderExpenseDocument(id);
    if (!rendered.ok) {
      console.error(`[expense] ${id}: the cover page could not be drawn`, rendered);
      return documentFailure(rendered);
    }
    cover = rendered.bytes;
    filename = rendered.filename;
  }

  return new Response(new Uint8Array(cover), {
    headers: {
      "Content-Type": "application/pdf",
      // An unbooked cover is drawn per request from moving attestations, so held briefly and never written to disk.
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
