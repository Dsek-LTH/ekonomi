// Undoing what booking and exporting did.
//
// Three operations, each unwinding exactly one step, and none of them reaching
// into Fortnox. That last part is the whole shape of this file: a voucher that
// has been pushed over there is over there, and nothing here can take it back.
// So each operation is honest about how far it goes, and the order they have to
// be used in is enforced rather than explained:
//
//   unexport  EXPORTED → BOOKED   this app forgets the Fortnox voucher; the
//                                 voucher itself stays, and re-exporting would
//                                 make a second one, so somebody has to go and
//                                 reverse it by hand;
//   reopen    BOOKED   → DRAFT    the verifikation is deleted and the day goes
//                                 back to being editable, at its own address;
//   delete    BOOKED   → gone     the day, its lines and its verifikation.
//     or      DRAFT    → gone
//
// An exported day can be neither reopened nor deleted. That is not timidity: it
// is the one state where this database and Fortnox agree about a figure, and
// breaking that agreement should be a thing someone did on purpose, in a step
// of its own, rather than a side effect of tidying up.
import "server-only";

import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort } from "@/lib/server/storage";
import type { IncomeReportStatus } from "@/lib/domain/types";

export type LifecycleFailure =
  | { reason: "reportNotFound" }
  | { reason: "unexportOnlyExported"; status: IncomeReportStatus }
  | { reason: "reopenOnlyBooked"; status: IncomeReportStatus }
  /** Delete refuses while Fortnox still has the voucher. Unexport first. */
  | { reason: "deleteExportedFirst" };

type LifecycleResult = { ok: true } | ({ ok: false } & LifecycleFailure);

/**
 * Forget the Fortnox voucher: EXPORTED → BOOKED.
 *
 * The counterpart of the utlägg's "unexport" (api/expenses/[id]/transition),
 * and unwinding the same amount: our record of the export, and nothing else.
 * The voucher stays in Fortnox, which is why this is behind the treasury roles:
 * the people who can go and reverse it there.
 */
export async function unexportIncomeReport(id: string): Promise<LifecycleResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  if (report.status !== "EXPORTED") {
    return { ok: false, reason: "unexportOnlyExported", status: report.status };
  }

  await prisma.$transaction(async (tx) => {
    // Still exported when the write lands: two people undoing the same export
    // would otherwise both believe they did it.
    await tx.incomeReport.updateMany({
      where: { id, status: "EXPORTED" },
      data: { status: "BOOKED" },
    });
    await tx.verification.updateMany({
      where: { incomeReportId: id },
      data: { fortnoxSeries: null, fortnoxNumber: null, fortnoxYear: null, exportedAt: null },
    });
  });

  return { ok: true };
}

/**
 * Take a booked day apart again: BOOKED → DRAFT, and the verifikation goes.
 *
 * The document goes with it. A stored intäktsräkning is the evidence behind a
 * figure in the ledger, and once the figure is gone the bytes substantiate
 * nothing. Worse, they are a picture of the day *before* whatever correction
 * is about to be made to it. The next booking stores a freshly rendered one
 * (lib/income/document.ts), which is what the corrected day actually says.
 *
 * What comes back is an ordinary draft, in the ordinary queue, with nothing
 * marking it as special. So it waits there to be booked again, and the next
 * fetch sweeps it away like any other draft, which is the right answer for a
 * day whose takings that fetch brings back anyway.
 */
export async function reopenIncomeReport(id: string): Promise<LifecycleResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, status: true, documentKey: true },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  // EXPORTED is deliberately not reopenable: unexport it first, so forgetting
  // the Fortnox voucher is its own decision.
  if (report.status !== "BOOKED") {
    return { ok: false, reason: "reopenOnlyBooked", status: report.status };
  }

  await prisma.$transaction(async (tx) => {
    await tx.incomeReport.updateMany({
      where: { id, status: "BOOKED" },
      data: { status: "DRAFT", documentKey: null, documentFilename: null },
    });
    await tx.verification.deleteMany({ where: { incomeReportId: id } });
  });

  // After the row, and best-effort: an object nothing points at is rubbish a
  // sweep can collect, while a row pointing at an object that is already gone
  // is a report whose document 404s.
  if (report.documentKey) await deleteObjectBestEffort(report.documentKey);

  return { ok: true };
}

/**
 * Remove a day entirely: the report, its sold lines and its verifikation.
 *
 * The lines and the voucher go by foreign key (both cascade from the report),
 * so what is left to do by hand is the stored PDF.
 *
 * Refused while the day is exported. Deleting then would leave Fortnox holding
 * a voucher for takings this app has no record of at all, which is the one
 * outcome nobody could reconstruct afterwards.
 */
export async function deleteIncomeReport(id: string): Promise<LifecycleResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, status: true, documentKey: true },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  if (report.status === "EXPORTED") return { ok: false, reason: "deleteExportedFirst" };

  await prisma.incomeReport.delete({ where: { id } });
  if (report.documentKey) await deleteObjectBestEffort(report.documentKey);

  return { ok: true };
}
