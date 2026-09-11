// Export a BOOKED expense's voucher to Fortnox: create the voucher, attach
// the receipt, store the returned voucher number, and only then flip the expense
// to EXPORTED. If the Fortnox call fails, nothing is mutated locally. The
// bookkeeper can retry. The [id] param is the expense id.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { getObjectBuffer } from "@/lib/server/storage";
import { storeExpenseDocument } from "@/lib/expense/document";
import { mergeCoverAndReceipts, PdfMergeError } from "@/lib/server/pdf-merge";
import {
  createVoucher,
  getConnection,
  uploadInboxFile,
  FortnoxError,
} from "@/lib/fortnox";
import {
  attachBestEffort,
  recordExport,
  userToken,
  voucherRows,
  VOUCHER_INCLUDE,
} from "@/lib/fortnox/export";
import { voucherText } from "@/lib/fortnox/voucher-text";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const user = g.actor;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      verification: VOUCHER_INCLUDE,
      // Every one still attached, in the order they were uploaded, which is
      // the order they are stapled behind the cover. No odometer readings
      // loaded here: a milersättning's journey is printed on the cover, and
      // the cover reads them itself.
      receipts: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!expense) return fail(404, "expense.notFound");
  if (expense.status !== "BOOKED") {
    return fail(409, "expense.exportOnlyBooked", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }
  const verification = expense.verification;
  if (!verification) return fail(409, "expense.noVoucherToExport");

  const conn = await getConnection();
  if (!conn) return fail(409, "fortnox.notConnectedBookkeeping");

  const rows = voucherRows(verification.lines);

  // The bookkeeper's own Fortnox login, not the service account's. See
  // lib/fortnox/export.ts.
  const auth = await userToken(user.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // The receipt goes up FIRST. A voucher can't be deleted through the API, so
  // anything that fails after it exists leaves a mess someone has to clean up
  // by hand in Fortnox, whereas a file sitting unused in the inbox is
  // harmless. Getting the fragile half out of the way first means a failed
  // upload costs nothing but a retry.
  //
  // An expense with no receipt at all still exports; that's a bookkeeping
  // judgement made when it was booked, not something to relitigate here.
  //
  // What goes up is the utläggsräkning: the cover page naming who attested each
  // cost-centre slice, with the receipt behind it. That is the whole point of
  // the page. In Fortnox a voucher's attachment is the only place the approval
  // trail can be seen, and a bare receipt does not carry it. For a
  // milersättning it is that page and nothing else: the journey is printed on
  // it, and there is no receipt for driving your own car.
  //
  // The cover is written here, at export, and the receipt is already stored;
  // they are joined on the way out rather than archived merged, so the
  // receipt's bytes are held once. See lib/server/pdf-merge.ts.
  //
  // A cover that cannot be drawn stops the export, and deliberately, unlike
  // the document route, which falls back to showing the underlag bare rather
  // than nothing. The asymmetry is the point: looking at an utlägg without its
  // cover costs the reader a page they can see elsewhere, while *filing* one
  // without it puts a voucher in Fortnox with no attest trail, which is the
  // exact condition this whole document exists to remove. A failure here is
  // also actionable. Somebody pressed a button and can press it again.
  let fileId: string | null = null;
  let coverWarning: string | null = null;
  {
    // Which half failed is what the bookkeeper needs to know, so the step is
    // carried as a code the client words.
    let step = "renderCover";
    try {
      const stored = await storeExpenseDocument(id);
      if (!stored.ok) {
        throw new Error(
          stored.reason === "renderFailed" ? stored.detail : `cover ${stored.reason}`,
        );
      }
      step = "readReceipt";
      const cover = new Uint8Array((await getObjectBuffer(stored.key)).bytes);
      // What goes behind the cover: every underlag still attached, in the
      // order they were uploaded. A milersättning has none and needs none.
      // Its journey is a section of the cover, so the one file uploaded here
      // is already the whole utläggsräkning and its underlag together.
      const underlag = await Promise.all(
        expense.receipts.map(async (r) => ({
          bytes: new Uint8Array((await getObjectBuffer(r.objectKey)).bytes),
          mimeType: r.mimeType,
        })),
      );

      // A receipt that will not merge must not stop the utlägg being booked:
      // the file came from a supplier and we do not get to choose its shape.
      // It is left out and the bookkeeper is told, which leaves that one
      // document to be attached by hand, the same shape as `attachWarning`
      // below, and far better than an export that cannot run. The rest of
      // the underlag, and the cover, still go up.
      let bytes: Uint8Array;
      try {
        const merged = await mergeCoverAndReceipts(cover, underlag);
        bytes = merged.bytes;
        if (merged.failed > 0) {
          coverWarning = `${merged.failed} of ${underlag.length} underlag could not be attached`;
          console.error(
            `[fortnox] ${id}: exporting without ${merged.failed} of ${underlag.length} underlag`,
          );
        }
      } catch (e) {
        if (!(e instanceof PdfMergeError)) throw e;
        coverWarning = e.message;
        console.error(`[fortnox] ${id}: exporting the cover without its underlag`, e);
        bytes = cover;
      }

      step = "uploadReceipt";
      fileId = await uploadInboxFile(
        token,
        Buffer.from(bytes),
        stored.filename,
        "application/pdf",
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[fortnox] ${id}: step ${step} failed`, e);
      return fail(e instanceof FortnoxError ? (e.status ?? 502) : 502, "expense.receiptStepFailed", {
        values: { step: { key: `errors.expense.exportStep.${step}` }, detail },
      });
    }
  }

  let created;
  try {
    created = await createVoucher(token, {
      series: conn.voucherSeries,
      date: verification.date.toISOString().slice(0, 10),
      description: voucherText(verification.description, expense.reference),
      rows,
    });
  } catch (e) {
    if (e instanceof FortnoxError) return fail(e.status ?? 502, e.message);
    return fail(502, "expense.exportFailed");
  }

  // Surfaced verbatim beside the success message, so it is worded by the client
  // from this code. See `attachBestEffort` for why this one step is allowed to
  // fail without failing the export.
  const attachWarning = await attachBestEffort(token, fileId, created, id);

  const label = `${created.series}-${created.number}`;
  await recordExport(verification.id, created, async (tx) => {
    await tx.expense.update({ where: { id: expense.id }, data: { status: "EXPORTED" } });
    await tx.expenseEvent.create({
      data: {
        expenseId: expense.id,
        type: "EXPORTED",
        actorId: user.id,
        comment: label,
      },
    });
  });

  return NextResponse.json({
    id,
    voucher: created,
    label,
    attachWarning,
    // The export worked and the cover is on the voucher, but its underlag is
    // not, worded beside the success the same way `attachWarning` is, because
    // the thing left to do by hand is the same kind of thing.
    coverWarning,
  });
}
