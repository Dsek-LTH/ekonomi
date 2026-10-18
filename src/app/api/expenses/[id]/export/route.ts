// Export a BOOKED expense's voucher to Fortnox: create the voucher, attach
// the receipt, store the returned voucher number, and only then flip the expense
// to EXPORTED. If the Fortnox call fails, nothing is mutated locally. The
// bookkeeper can retry. The [id] param is the expense id.
//
// An utlägg is exported once, never twice: Fortnox has no delete for a
// voucher. So the first thing a press of Exportera does is take the export lock
// (lib/server/export-claim.ts), and a second press, from anyone, is refused
// while it is held. The lock is let go when the export is recorded, or when it
// is certain no voucher was made. When it is not certain (Fortnox did not
// answer, or answered with a server error) it stays, marked uncertain, until
// a bookkeeper has looked in Fortnox and said which.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
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
import { deliverSoon, notify } from "@/lib/server/notify";
import { expenseNotice } from "@/lib/email/content";
import { RECEIPT_ORDER } from "@/lib/data/receipt-order";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  // The status check is the lock's, made with the row held, so that it is
  // still true when the lock is written.
  const taken = await claimExport(id, g.actor.id);
  if (!taken.ok) return taken.res;
  const { claim } = taken;

  // Until the voucher request has gone, every way out is one where Fortnox has
  // no voucher, so the lock is let go and the bookkeeper can press again. After
  // it has gone, the export lets go of the lock itself, and only on certainty.
  const sent = { value: false };
  try {
    const res = await exportHolding(id, g.actor, claim, sent);
    if (!res.ok && !sent.value) await releaseExport(claim);
    return res;
  } catch (e) {
    // Thrown after the request went: the voucher may exist, and nothing here
    // knows whether it does.
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
      // Every one still attached, in the order they were uploaded, which is
      // the order they are stapled behind the cover. No odometer readings
      // loaded here: a milersättning's journey is printed on the cover, and
      // the cover reads them itself.
      receipts: { orderBy: RECEIPT_ORDER },
    },
  });
  if (!expense) return fail(404, "expense.notFound");
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

  // The point of no return. Said in the row, and committed, before the
  // request goes: a crash from here on must leave a lock that says a voucher
  // may exist. A lock that is no longer ours (taken over after this export sat
  // too long before sending) means somebody else is exporting it, and this
  // one stops here.
  if (!(await markSent(claim))) return fail(409, "expense.changedMeanwhile");
  sent.value = true;

  let created;
  try {
    created = await createVoucher(token, {
      series: conn.voucherSeries,
      date: verification.date.toISOString().slice(0, 10),
      description: voucherText(verification.description, expense.reference),
      rows,
    });
  } catch (e) {
    // A refusal Fortnox put a reason to (a 4xx: an account it does not know,
    // a login that ran out) made no voucher. That is certain, so the lock goes
    // and the bookkeeper fixes the cause and presses again.
    if (e instanceof FortnoxError && e.status && e.status >= 400 && e.status < 500) {
      await releaseExport(claim);
      return fail(e.status, e.message);
    }
    // Anything else (no answer, a dropped connection, a 5xx, an answer we
    // could not read) may have made one. Kept, and said so.
    console.error(`[fortnox] ${id}: voucher request ended without a clear answer`, e);
    await markUncertain(claim);
    return fail(502, "expense.exportUncertain", { values: { name: user.name } });
  }

  const label = `${created.series}-${created.number}`;
  try {
    await recordExport(verification.id, created, async (tx) => {
      // Still ours, and still BOOKED. It cannot be otherwise: nothing lets go
      // of a lock in SENT while the request is in flight. But a voucher that
      // exists and a record that disagrees is the one outcome this route is
      // built to avoid, so it is checked rather than assumed.
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
      await notify(tx, "EXPENSE_EXPORTED", [expense.submitterId], expenseNotice("exported", expense), {
        exclude: [user.id],
      });
    });
  } catch (e) {
    // The voucher is in Fortnox and is not recorded here. The lock stays, as
    // uncertain, and the label is said loudly so it can be entered by hand.
    console.error(`[fortnox] ${id}: voucher ${label} was made but could not be recorded`, e);
    await markUncertain(claim);
    return fail(500, "expense.exportUnrecorded", { values: { label } });
  }
  deliverSoon();

  // After the record, not before it. The voucher exists from the moment
  // Fortnox answered, and every step between that and the record is time in
  // which the lock says SENT for a voucher that is already there. Attaching is
  // a second request to Fortnox, so it waits until the export is safely written
  // down here.
  //
  // Surfaced verbatim beside the success message, so it is worded by the client
  // from this code. See `attachBestEffort` for why this one step is allowed to
  // fail without failing the export.
  const attachWarning = await attachBestEffort(token, fileId, created, id);

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
