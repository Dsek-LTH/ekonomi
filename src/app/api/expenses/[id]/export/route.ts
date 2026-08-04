// Export a BOOKED expense's voucher to Fortnox: create the voucher, attach
// the receipt, store the returned voucher number, and only then flip the expense
// to EXPORTED. If the Fortnox call fails, nothing is mutated locally — the
// bookkeeper can retry. The [id] param is the expense id.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { fail, gate } from "@/lib/api/guard";
import { getObjectBuffer } from "@/lib/server/storage";
import { expenseLabel } from "@/lib/domain/reference";
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
  const receipt = expense.receipts[0];
  let fileId: string | null = null;
  if (receipt) {
    // Which half failed is what the bookkeeper needs to know, so the step is
    // carried as a code the client words.
    let step = "readReceipt";
    try {
      const { bytes } = await getObjectBuffer(receipt.objectKey);
      step = "uploadReceipt";
      fileId = await uploadInboxFile(token, bytes, receipt.filename, receipt.mimeType);
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
      description: `${expenseLabel(expense)} – ${verification.description}`,
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
    ok: true,
    id,
    voucher: created,
    label,
    attachWarning,
  });
}
