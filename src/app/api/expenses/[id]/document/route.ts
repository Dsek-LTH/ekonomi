// Serve the utläggsräkning, the cover page naming who attested what.
//
// The cover *alone*. The underlag is a document of its own and the panel pages
// to it (lib/expense/document-url.ts); stapling the two together is something
// done on the way to Fortnox and nowhere else, because that is the one place
// that needs a single file. See lib/server/pdf-merge.ts.
//
// The same two answers the income document route gives, for the same reason. A
// booked utlägg has its cover in storage and it is read from there, because
// those bytes are what went to Fortnox and must never be re-made: the page
// names attestations, and re-rendering after a reopen would quietly produce a
// different document from the one already filed. Anything not yet booked has no
// stored cover and gets one drawn on the way past, kept by nobody.
import { fail, gate } from "@/lib/api/guard";
import { denyExpenseView } from "@/lib/api/expense-access";
import { renderExpenseDocument, type DocumentFailure } from "@/lib/expense/document";
import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";

/** One mapping from "why there is no document" to an HTTP answer. */
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

  // A cover is exactly as private as the utlägg it describes. It is that
  // utlägg, restated. Same gate the receipts are behind.
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
    // A cover that will not draw is now only the cover's problem: the underlag
    // is its own document in the panel and is still there to read. Loud in the
    // log, and this page alone says so on screen.
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
      // A stored cover is fixed, but an unbooked one is drawn per request from
      // attestations that are still moving, so this is held briefly and never
      // written to disk.
      "Cache-Control": "private, max-age=60",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
