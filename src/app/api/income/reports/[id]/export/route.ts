// Push a booked income voucher to Fortnox: create the verifikation, attach the
// intäktsräkning, record the number, and only then flip the report to EXPORTED.
//
// Deliberately the same shape as api/expenses/[id]/export, including the order
// the two Fortnox calls happen in and the reason for it. A voucher cannot be
// deleted through the API, so anything that fails after one exists leaves a
// mess to be cleaned up by hand in Fortnox; a file sitting unused in the inbox
// is harmless. The fragile half goes first.
//
// The voucher is written with the bookkeeper's OWN Fortnox login rather than
// the service account, so Fortnox stamps it with their name. This is the whole
// reason booking lives in the app and not in the intakt service, which has no
// idea who is signed in.
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { canBookkeep } from "@/lib/domain/permissions";
import { createVoucher, getConnection, uploadInboxFile, FortnoxError } from "@/lib/fortnox";
import {
  attachBestEffort,
  recordExport,
  userToken,
  voucherRows,
  VOUCHER_INCLUDE,
} from "@/lib/fortnox/export";
import { fortnoxIncomeVouchers, incomeVoucherKey } from "@/lib/income/duplicate";
import { incomeVoucherSeries } from "@/lib/income/voucher";
import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import { getObjectBuffer } from "@/lib/server/storage";

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

  const conn = await getConnection();
  if (!conn) return fail(409, "fortnox.notConnectedBookkeeping");

  // Which verifikationsserie takings are filed under: its own setting, falling
  // back to the connection's. The duplicate check below reads the same one
  // through the same function, which is the point of there being one.
  const settings = await loadBookkeepingSettings();
  const series = incomeVoucherSeries(settings, conn.voucherSeries);
  if (!series) return fail(409, "settings.voucherSeriesUnset");

  // The last gate before anything is written over there. Import already refuses
  // to bring in a day Fortnox has a voucher for, but that check ran against the
  // range as it was then. This one runs against the day as it is now, with
  // whatever has been exported since, including by someone else in the last
  // minute. Before the file upload deliberately: a refusal here leaves nothing
  // behind at all.
  const voucherDate = verification.date.toISOString().slice(0, 10);
  const existing = await fortnoxIncomeVouchers(voucherDate, voucherDate);
  const duplicate = existing.byKey.get(incomeVoucherKey(voucherDate, verification.description));
  if (duplicate) {
    return fail(409, "income.alreadyInFortnox", { values: { voucher: duplicate } });
  }

  const rows = voucherRows(verification.lines);

  const auth = await userToken(g.actor.id);
  if (!auth.ok) return auth.res;
  const token = auth.token;

  // The intäktsräkning goes up first, for the reason at the top of this file.
  // Unlike an expense, a report always has one: it is rendered at import, and
  // booking will not have got this far without it.
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
      return fail(e instanceof FortnoxError ? (e.status ?? 502) : 502, "income.documentStepFailed", {
        values: { step: { key: `errors.income.exportStep.${step}` }, detail },
      });
    }
  }

  let created;
  try {
    created = await createVoucher(token, {
      series,
      date: verification.date.toISOString().slice(0, 10),
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
