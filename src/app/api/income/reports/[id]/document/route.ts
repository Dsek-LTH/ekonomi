// Serve the intäktsräkning for a report. Booked: streamed from storage (browser <- Next <- MinIO,
// as receipts) and never re-made. Draft: rendered on the way past and stored by nobody.

import { fail, gate } from "@/lib/api/guard";
import { canViewBookkeeping } from "@/lib/domain/permissions";
import { renderIncomeDocument, type DocumentFailure } from "@/lib/income/document";
import { loadUser } from "@/lib/server/current-user";
import { prisma } from "@/lib/server/db";
import { getObjectStream } from "@/lib/server/storage";

/** One mapping from "why there is no document" to an HTTP answer. */
function documentFailure(failure: DocumentFailure) {
  switch (failure.reason) {
    case "reportNotFound":
      return fail(404, "income.reportNotFound");
    case "legacyReport":
      // Stored then, so reaching here means the stored copy is gone.
      return fail(404, "income.documentMissing");
    case "renderFailed":
      return fail(502, "income.renderFailed", { values: { detail: failure.detail } });
    case "storeFailed":
      return fail(502, "income.storeFailed");
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // Bookkeeping's business, the same gate as the pages that link here.
  const g = await gate(canViewBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, documentKey: true, documentFilename: true },
  });
  if (!report) return fail(404, "income.reportNotFound");

  // ── Booked: the stored bytes, and only those ──

  if (report.documentKey) {
    // Storage unreachable is an outage; a missing object is a lost verifikat (as the receipt route).
    let obj;
    try {
      obj = await getObjectStream(report.documentKey);
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") {
        console.error(`[income] ${id}: object ${report.documentKey} is gone`, e);
        return fail(404, "income.documentMissing");
      }
      console.error(`[income] ${id}: storage unreachable`, e);
      return fail(503, "income.storageUnavailable");
    }

    const filename = report.documentFilename ?? "intaktsrakning.pdf";
    const headers = new Headers({
      "Content-Type": obj.contentType,
      "Cache-Control": "private, max-age=0, no-store",
      "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
    });
    if (obj.contentLength != null) headers.set("Content-Length", String(obj.contentLength));
    return new Response(obj.body, { headers });
  }

  // ── Draft: rendered for this look ──

  const user = await loadUser(g.actor.id);
  if (!user) return fail(401, "auth.signedOut");

  const rendered = await renderIncomeDocument(id, {
    name: user.name,
    studentId: user.studentId,
  });
  if (!rendered.ok) return documentFailure(rendered);

  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      // Kept by the browser a few minutes; private and short since a draft is unbooked takings.
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${encodeURIComponent(rendered.filename)}"`,
    },
  });
}
