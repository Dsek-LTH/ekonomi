// Export a BOOKED expense's voucher to Fortnox: create the voucher, attach
// the receipt, store the returned voucher number, and only then flip the expense
// to EXPORTED. If the Fortnox call fails, nothing is mutated locally — the
// bookkeeper can retry. The [id] param is the expense id.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { getObjectBuffer } from "@/lib/server/storage";
import { storeExpenseDocument } from "@/lib/expense/document";
import { mergeCoverAndReceipt, PdfMergeError } from "@/lib/server/pdf-merge";
import {
  connectFileToVoucher,
  createVoucher,
  getConnection,
  getUserToken,
  uploadInboxFile,
  FortnoxAuthRequiredError,
  FortnoxError,
  type VoucherRowInput,
} from "@/lib/fortnox";
import { voucherText } from "@/lib/fortnox/voucher-text";

const ore = (n: number) => Math.round(n) / 100; // öre int → SEK decimal

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.bookkeeperExport");
  if (!g.ok) return g.res;
  const user = g.actor;

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: {
      verification: { include: { lines: { include: { costCenter: true } } } },
      receipts: { orderBy: { createdAt: "desc" }, take: 1 },
      // No odometer readings loaded here: a milersättning's journey is printed
      // on the cover, and the cover reads them itself.
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

  const rows: VoucherRowInput[] = verification.lines.map((l) => ({
    account: Number(l.account),
    debit: ore(l.debit),
    credit: ore(l.credit),
    // Only a cost centre Fortnox itself knows about. A local one is an app-side
    // dimension (it drives attest and the budget) that Fortnox has never heard
    // of, and sending its code would have the whole voucher rejected.
    costCenter: l.costCenter?.source === "FORTNOX" ? l.costCenter.code : undefined,
    description: l.description ?? undefined,
  }));

  // The voucher is written with the bookkeeper's OWN Fortnox login, not the
  // service account, so Fortnox attributes it to them by name. Fetched before
  // the try block: needing to log in is a prompt, not an export failure.
  let token: string;
  try {
    token = await getUserToken(user.id);
  } catch (e) {
    if (e instanceof FortnoxAuthRequiredError) {
      return fail(401, e.message, { extra: { needsFortnoxLogin: true } });
    }
    throw e;
  }

  // The receipt goes up FIRST. A voucher can't be deleted through the API, so
  // anything that fails after it exists leaves a mess someone has to clean up
  // by hand in Fortnox — whereas a file sitting unused in the inbox is
  // harmless. Getting the fragile half out of the way first means a failed
  // upload costs nothing but a retry.
  //
  // An expense with no receipt at all still exports; that's a bookkeeping
  // judgement made when it was booked, not something to relitigate here.
  //
  // What goes up is the utläggsräkning: the cover page naming who attested each
  // cost-centre slice, with the receipt behind it. That is the whole point of
  // the page — in Fortnox a voucher's attachment is the only place the approval
  // trail can be seen, and a bare receipt does not carry it. For a
  // milersättning it is that page and nothing else: the journey is printed on
  // it, and there is no receipt for driving your own car.
  //
  // The cover is written here, at export, and the receipt is already stored;
  // they are joined on the way out rather than archived merged, so the
  // receipt's bytes are held once. See lib/server/pdf-merge.ts.
  //
  // A cover that cannot be drawn stops the export, and deliberately — unlike
  // the document route, which falls back to showing the underlag bare rather
  // than nothing. The asymmetry is the point: looking at an utlägg without its
  // cover costs the reader a page they can see elsewhere, while *filing* one
  // without it puts a voucher in Fortnox with no attest trail, which is the
  // exact condition this whole document exists to remove. A failure here is
  // also actionable — somebody pressed a button and can press it again.
  const receipt = expense.receipts[0];
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
      // What goes behind the cover: the receipt, where there is one. A
      // milersättning has none and needs none — its journey is a section of the
      // cover, so the one file uploaded here is already the whole utläggsräkning
      // and its underlag together.
      const underlag = receipt
        ? {
            bytes: new Uint8Array((await getObjectBuffer(receipt.objectKey)).bytes),
            mimeType: receipt.mimeType,
          }
        : null;

      // A receipt that will not merge must not stop the utlägg being booked:
      // the file came from a supplier and we do not get to choose its shape.
      // The cover goes up alone and the bookkeeper is told, which leaves the
      // receipt to be attached by hand — the same shape as `attachWarning`
      // below, and far better than an export that cannot run.
      let bytes: Uint8Array;
      try {
        bytes = await mergeCoverAndReceipt(cover, underlag);
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
  let attachWarning: string | null = null;
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

  // Linking needs the voucher's series and number, so this is the one step that
  // can only run after it exists — and therefore the only one still best
  // effort. The file is already uploaded, so a failure here means attaching it
  // by hand in Fortnox, not redoing the export.
  if (fileId) {
    try {
      await connectFileToVoucher(
        token,
        fileId,
        created.series,
        created.number,
        created.year ?? undefined,
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      // Surfaced verbatim beside the success message, so it is worded by the
      // client from this code.
      attachWarning = detail;
      console.error(`[fortnox] ${id}: could not attach the receipt to the voucher`, e);
    }
  }

  const label = `${created.series}-${created.number}`;
  await prisma.$transaction(async (tx) => {
    await tx.verification.update({
      where: { id: verification.id },
      data: {
        fortnoxSeries: created.series,
        fortnoxNumber: created.number,
        fortnoxYear: created.year,
        exportedAt: new Date(),
      },
    });
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
    // not — worded beside the success the same way `attachWarning` is, because
    // the thing left to do by hand is the same kind of thing.
    coverWarning,
  });
}
