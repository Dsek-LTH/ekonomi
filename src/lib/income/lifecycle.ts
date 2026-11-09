// Undoing booking and exporting: unexport (EXPORTED -> BOOKED), reopen (BOOKED -> DRAFT) and
// delete (DRAFT or BOOKED -> gone). None of them touch Fortnox. An exported day can be neither
// reopened nor deleted: unexport it first.

import "server-only";

import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort } from "@/lib/server/storage";
import type { IncomeReportStatus } from "@/lib/domain/types";
import { isLegacyReport } from "./legacy";

export type LifecycleFailure =
  | { reason: "reportNotFound" }
  | { reason: "unexportOnlyExported"; status: IncomeReportStatus }
  | { reason: "reopenOnlyBooked"; status: IncomeReportStatus }
  /** Booked before the per-day voucher. */
  | { reason: "reopenLegacy" }
  /** Delete refuses while Fortnox still has the voucher. Unexport first. */
  | { reason: "deleteExportedFirst" };

type LifecycleResult = { ok: true } | ({ ok: false } & LifecycleFailure);

/** Forget the Fortnox voucher. The voucher stays in Fortnox, so this is for the treasury roles who can reverse it there. */
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
    // Still exported when the write lands, so two people undoing the same export cannot both win.
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
 * BOOKED -> DRAFT, deleting the verifikation and its stored document (the next booking renders a
 * fresh one).
 */
export async function reopenIncomeReport(id: string): Promise<LifecycleResult> {
  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: { id: true, status: true, documentKey: true, source: true, resultUnitId: true },
  });
  if (!report) return { ok: false, reason: "reportNotFound" };
  // A legacy day would come back as a draft the booking screen cannot book.
  if (isLegacyReport(report)) return { ok: false, reason: "reopenLegacy" };
  // EXPORTED is not reopenable: unexport first.
  if (report.status !== "BOOKED") {
    return { ok: false, reason: "reopenOnlyBooked", status: report.status };
  }

  await prisma.$transaction(async (tx) => {
    await tx.incomeReport.updateMany({
      where: { id, status: "BOOKED" },
      // Unreviewed again.
      data: {
        status: "DRAFT",
        documentKey: null,
        documentFilename: null,
        reviewedById: null,
        reviewedAt: null,
      },
    });
    await tx.verification.deleteMany({ where: { incomeReportId: id } });
  });

  // After the row and best-effort: an orphan object is collectable, a row pointing at a missing one 404s.
  if (report.documentKey) await deleteObjectBestEffort(report.documentKey);

  return { ok: true };
}

/** Removes the report, its lines and verifikation (cascade) and the stored PDF. Refused while exported, since Fortnox would hold a voucher this app has no record of. */
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
