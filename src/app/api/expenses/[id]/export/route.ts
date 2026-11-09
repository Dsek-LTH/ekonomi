// Export a BOOKED expense's voucher to Fortnox: create the voucher, attach the receipt, store the voucher number, only then flip to EXPORTED.
// A failed Fortnox call mutates nothing locally. Exported once, never twice (Fortnox has no voucher delete), so the first step is
// taking the export lock (lib/server/export-claim.ts). It is let go when the export is recorded or certainly made no voucher,
// otherwise it stays UNCERTAIN until a bookkeeper has looked in Fortnox.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { fail, gate, type Actor } from "@/lib/api/guard";
import { applied } from "@/lib/api/stale-write";
import {
  CLEARED,
  claimExport,
  markSent,
  markUncertain,
  releaseExport,
  type ExportClaim,
} from "@/lib/server/export-claim";
import { getObjectBuffer } from "@/lib/server/storage";
import { storeExpenseDocument } from "@/lib/expense/document";
import { mergeCoverAndReceipts, PdfMergeError } from "@/lib/server/pdf-merge";
import { createVoucher, getConnection, uploadInboxFile, FortnoxError } from "@/lib/fortnox";
import {
  attachBestEffort,
  recordExport,
  userToken,
  voucherRows,
  VOUCHER_INCLUDE,
} from "@/lib/fortnox/export";
import { voucherText } from "@/lib/fortnox/voucher-text";
import { deliverSoon, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";
import { RECEIPT_ORDER } from "@/lib/data/receipt-order";
import { exportReviewBlocker } from "@/lib/server/review";
import { isoDay } from "@/lib/domain/date";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  // The two-person rule (lib/domain/review.ts). Before the lock, so a refusal leaves nothing behind.
  if ((await exportReviewBlocker(id, g.actor)) === "ownBooking") {
    return fail(403, "expense.reviewOwnBooking");
  }

  // The status check is the lock's, made with the row held.
  const taken = await claimExport(id, g.actor.id);
  if (!taken.ok) return taken.res;
  const { claim } = taken;

  // Until the voucher request has gone, every way out releases the lock. After it, the export releases it only on certainty.
  const sent = { value: false };
  try {
    const res = await exportHolding(id, g.actor, claim, sent);
    if (!res.ok && !sent.value) await releaseExport(claim);
    return res;
  } catch (e) {
    // Thrown after the request went: the voucher may exist.
    await (sent.value ? markUncertain(claim) : releaseExport(claim));
    throw e;
  }
}

async function exportHolding(
  id: string,
  user: Actor,
  claim: ExportClaim,
  sent: { value: boolean },
): Promise<NextResponse> {
  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      verification: VOUCHER_INCLUDE,
      // Every attached underlag, in upload order (the stapling order). No odometer readings: the cover reads them itself.
      receipts: { orderBy: RECEIPT_ORDER },
    },
  });
  if (!expense) return fail(404, "expense.notFound");
  // The lock was only taken because it is BOOKED, and konterat means it has a
  // voucher. One without is a broken row, not a case to word for the user.
  const verification = expense.verification;
  if (!verification) throw new Error(`Expense ${id} is BOOKED but has no verification`);

  const conn = await getConnection();
  if (!conn) return fail(409, "fortnox.notConnectedBookkeeping");
  // The voucher series is a choice nobody has made. Refused before anything goes to Fortnox.
  const series = conn.voucherSeries;
  if (!series) return fail(409, "settings.voucherSeriesUnset");

  const rows = voucherRows(verification.lines);

  // The bookkeeper's own Fortnox login, not the service account's. See
  // lib/fortnox/export.ts.
  const auth = await userToken(user.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // The receipt goes up FIRST: a voucher can't be deleted through the API, while an unused file in the inbox is harmless.
  // What goes up is the utläggsräkning (the cover naming who attested each slice) with the receipt behind it, since the voucher's
  // attachment is the only place the approval trail can be seen. For a milersättning it is the cover alone (lib/server/pdf-merge.ts).
  // A cover that cannot be drawn stops the export, unlike the document route: filing a voucher without the attest trail is what
  // the page exists to prevent, and the bookkeeper can press again.
  let fileId: string | null = null;
  let coverWarning: string | null = null;
  {
    // The failed step is carried as a code the client words.
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
      // Every underlag still attached, in upload order. A milersättning has none: its journey is on the cover.
      const underlag = await Promise.all(
        expense.receipts.map(async (r) => ({
          bytes: new Uint8Array((await getObjectBuffer(r.objectKey)).bytes),
          mimeType: r.mimeType,
        })),
      );

      // A receipt that will not merge must not stop the booking: it is left out and the bookkeeper told, to attach by hand
      // (like `attachWarning`). The rest of the underlag and the cover still go up.
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
      fileId = await uploadInboxFile(token, Buffer.from(bytes), stored.filename, "application/pdf");
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[fortnox] ${id}: step ${step} failed`, e);
      return fail(
        e instanceof FortnoxError ? (e.status ?? 502) : 502,
        "expense.receiptStepFailed",
        {
          values: { step: { key: `errors.expense.exportStep.${step}` }, detail },
        },
      );
    }
  }

  // The point of no return: committed before the request goes, so a crash leaves a lock saying a voucher may exist.
  // A lock no longer ours means somebody else is exporting, and this one stops.
  if (!(await markSent(claim))) return fail(409, "expense.changedMeanwhile");
  sent.value = true;

  let created;
  try {
    created = await createVoucher(token, {
      series,
      date: isoDay(verification.date),
      description: voucherText(verification.description, expense.reference),
      rows,
    });
  } catch (e) {
    // A refusal with a reason (4xx) made no voucher, so the lock goes.
    if (e instanceof FortnoxError && e.status && e.status >= 400 && e.status < 500) {
      await releaseExport(claim);
      return fail(e.status, e.message);
    }
    // Anything else (no answer, 5xx, unreadable answer) may have made one: kept, and said so.
    console.error(`[fortnox] ${id}: voucher request ended without a clear answer`, e);
    await markUncertain(claim);
    return fail(502, "expense.exportUncertain", { values: { name: user.name } });
  }

  const label = `${created.series}-${created.number}`;
  try {
    await recordExport(verification.id, created, async (tx) => {
      // Still ours and still BOOKED. Checked rather than assumed: a voucher and a disagreeing record is the outcome this route avoids.
      applied(
        await tx.expense.updateMany({
          where: { id: expense.id, status: "BOOKED", exportClaimedAt: claim.token },
          data: { status: "EXPORTED", ...CLEARED },
        }),
      );
      await tx.expenseEvent.create({
        data: {
          expenseId: expense.id,
          type: "EXPORTED",
          actorId: user.id,
          comment: label,
        },
      });
      await notify(
        tx,
        "EXPENSE_EXPORTED",
        [expense.submitterId],
        expenseNotice("exported", expense),
        {
          exclude: [user.id],
        },
      );
    });
  } catch (e) {
    // The voucher is in Fortnox and not recorded here: the lock stays UNCERTAIN, and the label is said loudly so it can be entered by hand.
    console.error(`[fortnox] ${id}: voucher ${label} was made but could not be recorded`, e);
    await markUncertain(claim);
    return fail(500, "expense.exportUnrecorded", { values: { label } });
  }
  deliverSoon();

  // After the record: attaching is a second Fortnox request, and until the export is written down the lock says SENT
  // for a voucher that exists. Worded by the client from this code (see `attachBestEffort`).
  const attachWarning = await attachBestEffort(token, fileId, created, id);

  return NextResponse.json({
    id,
    voucher: created,
    label,
    attachWarning,
    // The cover is on the voucher but its underlag is not, worded like `attachWarning`.
    coverWarning,
  });
}
