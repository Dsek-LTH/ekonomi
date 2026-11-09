// Push a booked income voucher to Fortnox: create the verifikation, attach the intäktsräkning, record
// the number, then flip to EXPORTED. Same shape and call order as api/expenses/[id]/export (a voucher
// cannot be deleted through the API, so the fragile half goes first). Written with the bookkeeper's
// OWN Fortnox login so Fortnox stamps their name.

import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { canBookkeep, canReviewOwnBooking } from "@/lib/domain/permissions";
import { reviewBlocker } from "@/lib/domain/review";
import { createVoucher, getConnection, uploadInboxFile, FortnoxError } from "@/lib/fortnox";
import {
  attachBestEffort,
  recordExport,
  userToken,
  voucherRows,
  VOUCHER_INCLUDE,
} from "@/lib/fortnox/export";
import { fortnoxIncomeVouchers } from "@/lib/income/duplicate";
import { isLegacyReport } from "@/lib/income/legacy";
import { incomeVoucherSeries } from "@/lib/income/voucher";
import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import { getObjectBuffer } from "@/lib/server/storage";
import { isoDay } from "@/lib/domain/date";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    include: { verification: VOUCHER_INCLUDE },
  });
  if (!report) return fail(404, "income.reportNotFound");

  if (report.status !== "BOOKED") {
    return fail(409, "income.exportOnlyBooked", {
      values: { status: { key: `income.status.${report.status}` } },
    });
  }
  const verification = report.verification;
  if (!verification) return fail(409, "income.noVoucherToExport");

  // Granskning (lib/domain/review.ts): whoever konterade or hand-wrote the kontering does not bokföra, unless exempt.
  const own = reviewBlocker({
    exempt: canReviewOwnBooking(g.actor.capabilities),
    viewerId: g.actor.id,
    bookedBy: [report.reviewedById, verification.createdById, report.manualVoucherById].filter(
      (x): x is string => Boolean(x),
    ),
  });
  if (own) return fail(409, "income.ownBooking");

  const conn = await getConnection();
  if (!conn) return fail(409, "fortnox.notConnectedBookkeeping");

  // The series takings are filed under; the duplicate check reads the same one.
  const settings = await loadBookkeepingSettings();
  const series = incomeVoucherSeries(settings, conn.voucherSeries);
  if (!series) return fail(409, "settings.voucherSeriesUnset");

  // Last gate before anything is written: runs against the day as it is now (not as at import), before
  // the file upload so a refusal leaves nothing behind. A whole day is refused if any voucher already
  // books some of its money in this source (pre-per-day days match only their own text).
  const voucherDate = isoDay(verification.date);
  const existing = await fortnoxIncomeVouchers(voucherDate, voucherDate);
  const duplicate = isLegacyReport(report)
    ? existing.exact(voucherDate, verification.description)
    : existing.forDay(voucherDate, report.source);
  if (duplicate) {
    return fail(409, "income.alreadyInFortnox", { values: { voucher: duplicate } });
  }

  const rows = voucherRows(verification.lines);

  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // The intäktsräkning goes up first. A report always has one (booking required it).
  let fileId: string | null = null;
  if (report.documentKey) {
    let step = "readDocument";
    try {
      const { bytes } = await getObjectBuffer(report.documentKey);
      step = "uploadDocument";
      fileId = await uploadInboxFile(
        token,
        bytes,
        report.documentFilename ?? "intaktsrakning.pdf",
        "application/pdf",
      );
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`[fortnox] income ${id}: step ${step} failed`, e);
      return fail(
        e instanceof FortnoxError ? (e.status ?? 502) : 502,
        "income.documentStepFailed",
        {
          values: { step: { key: `errors.income.exportStep.${step}` }, detail },
        },
      );
    }
  }

  let created;
  try {
    created = await createVoucher(token, {
      series,
      date: isoDay(verification.date),
      description: verification.description,
      rows,
    });
  } catch (e) {
    if (e instanceof FortnoxError) return fail(e.status ?? 502, e.message);
    return fail(502, "income.exportFailed");
  }

  const attachWarning = await attachBestEffort(token, fileId, created, `income ${id}`);

  const label = `${created.series}-${created.number}`;
  await recordExport(verification.id, created, async (tx) => {
    await tx.incomeReport.update({ where: { id: report.id }, data: { status: "EXPORTED" } });
  });

  return NextResponse.json({ id, voucher: created, label, attachWarning });
}
