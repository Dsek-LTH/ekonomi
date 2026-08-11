// Push a booked income voucher to Fortnox: create the verifikation, attach the
// intäktsräkning, record the number, and only then flip the report to EXPORTED.
//
// Deliberately the same shape as api/expenses/[id]/export — including the order
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
import { canAccessBookkeeping } from "@/lib/domain/permissions";
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
import { fortnoxIncomeVouchers, incomeVoucherKey } from "@/lib/income/duplicate";
import { incomeVoucherSeries } from "@/lib/income/voucher";
import { prisma } from "@/lib/server/db";
import { getObjectBuffer } from "@/lib/server/storage";

const ore = (n: number) => Math.round(n) / 100; // öre int → SEK decimal

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.bookkeeperExport");
  if (!g.ok) return g.res;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    include: { verification: { include: { lines: { include: { costCenter: true } } } } },
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

  // Which verifikationsserie takings are filed under — its own setting, falling
  // back to the connection's. The duplicate check below reads the same one
  // through the same function, which is the point of there being one.
  const settings = await prisma.bookkeepingSettings.findUnique({
    where: { id: "singleton" },
    select: { incomeVoucherSeries: true },
  });
  const series = incomeVoucherSeries(settings, conn.voucherSeries);

  // The last gate before anything is written over there. Import already refuses
  // to bring in a day Fortnox has a voucher for, but that check ran against the
  // range as it was then — this one runs against the day as it is now, with
  // whatever has been exported since, including by someone else in the last
  // minute. Before the file upload deliberately: a refusal here leaves nothing
  // behind at all.
  const voucherDate = verification.date.toISOString().slice(0, 10);
  const existing = await fortnoxIncomeVouchers(voucherDate, voucherDate);
  const duplicate = existing.byKey.get(incomeVoucherKey(voucherDate, verification.description));
  if (duplicate) {
    return fail(409, "income.alreadyInFortnox", { values: { voucher: duplicate } });
  }

  const rows: VoucherRowInput[] = verification.lines.map((l) => ({
    account: Number(l.account),
    debit: ore(l.debit),
    credit: ore(l.credit),
    // Only a cost centre Fortnox itself knows about — a local one is an
    // app-side dimension it has never heard of, and sending its code would have
    // the whole voucher rejected.
    costCenter: l.costCenter?.source === "FORTNOX" ? l.costCenter.code : undefined,
    description: l.description ?? undefined,
  }));

  // Fetched before the try block: needing to log in is a prompt, not a failure.
  let token: string;
  try {
    token = await getUserToken(g.actor.id);
  } catch (e) {
    if (e instanceof FortnoxAuthRequiredError) {
      return fail(401, e.message, { extra: { needsFortnoxLogin: true } });
    }
    throw e;
  }

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
  let attachWarning: string | null = null;
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

  // The only step that can run after the voucher exists, and therefore the only
  // one still best effort: a failure here means attaching the PDF by hand in
  // Fortnox, not redoing the export.
  if (fileId) {
    try {
      await connectFileToVoucher(token, fileId, created.series, created.number, created.year ?? undefined);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      attachWarning = detail;
      console.error(`[fortnox] income ${id}: could not attach the document to the voucher`, e);
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
    await tx.incomeReport.update({ where: { id: report.id }, data: { status: "EXPORTED" } });
  });

  return NextResponse.json({ id, voucher: created, label, attachWarning });
}
