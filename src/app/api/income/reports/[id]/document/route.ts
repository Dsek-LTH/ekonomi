// Serve the intäktsräkning for a report, booked or not.
//
// Two ways to answer, and which one applies says what the report is. A booked
// report has its document in storage and it is streamed from there, browser ←
// Next ← MinIO, the same proxy model receipts use — those bytes are evidence
// and must never be re-made. A draft has none: it is rendered here, on the way
// past, and thrown away. Reviewing a term of takings therefore stores nothing,
// which is the point (see lib/income/document.ts).
import { fail, gate } from "@/lib/api/guard";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { renderIncomeDocument, type DocumentFailure } from "@/lib/income/document";
import { loadUser } from "@/lib/server/current-user";
import { prisma } from "@/lib/server/db";
import { getObjectStream } from "@/lib/server/storage";

/** One mapping from "why there is no document" to an HTTP answer. */
function documentFailure(failure: DocumentFailure) {
  switch (failure.reason) {
    case "reportNotFound":
      return fail(404, "income.reportNotFound");
    case "serviceUnavailable":
      return fail(503, "income.serviceUnavailable");
    case "noAttestation":
      return fail(409, "income.noAttestation");
    case "config":
      return fail(409, `income.${failure.blocker}`, {
        ...(failure.detail && { values: { detail: failure.detail } }),
      });
    case "renderFailed":
      return fail(502, "income.renderFailed", { values: { detail: failure.detail } });
    case "storeFailed":
      return fail(502, "income.storeFailed");
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // The whole section's takings, day by day — bookkeeping's business, and the
  // same gate the pages that link here are behind.
  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, documentKey: true, documentFilename: true },
  });
  if (!report) return fail(404, "income.reportNotFound");

  // ── Booked: the stored bytes, and only those ──

  if (report.documentKey) {
    // Two very different failures, told apart deliberately — the same
    // distinction the receipt route makes. Storage being unreachable is an
    // outage; an object storage says is not there is a verifikat that has gone
    // missing, and someone has to know.
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

  // ── Draft: rendered for this look, and kept by nobody ──

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
      // Held by the browser for a few minutes, so stepping back to a day you
      // just looked at costs nothing. Private and short: a draft is unbooked
      // takings, and pdflatex is the only thing standing behind this number.
      "Cache-Control": "private, max-age=300",
      "Content-Disposition": `inline; filename="${encodeURIComponent(rendered.filename)}"`,
    },
  });
}
