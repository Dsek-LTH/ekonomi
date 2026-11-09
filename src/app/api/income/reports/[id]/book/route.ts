// Book a day's takings: store the intäktsräkning, then write the verifikation. The voucher is
// derived from the lines (lib/income/voucher.ts) or a hand-written kontering whose lines are
// unchanged (lib/income/manual-voucher.ts). The PDF is stored before the verifikation, since an
// orphan object is collectable but a voucher without a document is unsubstantiated.

import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { withCostCenterTag } from "@/lib/domain/cost-center-tag";
import { canBookkeep } from "@/lib/domain/permissions";
import { voucherBlocker } from "@/lib/domain/voucher";
import { storeIncomeDocument } from "@/lib/income/document";
import { isLegacyReport } from "@/lib/income/legacy";
import {
  clearingRow,
  manualVoucherBlocker,
  voucherBasis,
  type ManualVoucherRow,
} from "@/lib/income/manual-voucher";
import {
  buildDayVoucherLines,
  incomeVoucherBlocker,
  incomeVoucherDescription,
  type IncomeVoucherLine,
} from "@/lib/income/voucher";
import { loadUser } from "@/lib/server/current-user";
import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!report) return fail(404, "income.reportNotFound");

  if (report.status !== "DRAFT") {
    return fail(409, "income.bookOnlyDraft", {
      values: { status: { key: `income.status.${report.status}` } },
    });
  }
  // A reopened pre-per-day-voucher day: reopening is refused (lib/income/lifecycle.ts), so a guard.
  if (isLegacyReport(report) || report.source === "ZETTLE_FEE") {
    return fail(409, "income.reopenLegacy");
  }
  // Some of this day's money is already booked here (the unique index would refuse; this says it).
  if (report.duplicateOfId) return fail(409, "income.alreadyBookedHere");

  const settings = await loadBookkeepingSettings();
  const clearingAccount =
    report.source === "SWISH" ? settings.swishClearingAccount : settings.zettleClearingAccount;
  if (!clearingAccount) {
    return fail(
      409,
      report.source === "SWISH"
        ? "settings.swishClearingAccountUnset"
        : "settings.zettleClearingAccountUnset",
    );
  }

  // ── The voucher, decided before anything is stored or written ──

  // A sale nobody gave a verksamhet (the routing table changed under a fetch).
  if (report.lines.some((l) => l.kind === "SALE" && !l.resultUnitId && l.total !== 0)) {
    return fail(422, "income.unplacedLines");
  }

  const accounts = await prisma.account.findMany({ select: { number: true, name: true } });
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const input = {
    lines: report.lines.map((l) => ({
      account: l.account,
      costCenterId: l.costCenterId,
      total: l.total,
    })),
    total: report.total,
    clearingAccount,
    accountName: (n: string) => accountName.get(n) ?? "",
  };

  // A hand-written kontering is booked as written if its lines are unchanged, else the lines' rows.
  const manual = report.manualVoucher as ManualVoucherRow[] | null;
  let lines: (IncomeVoucherLine & { project?: string | null; description?: string | null })[];
  let centreIds: string[];

  if (manual) {
    if (report.manualVoucherBasis !== voucherBasis(input.lines, report.total)) {
      return fail(409, "income.manualVoucherStale");
    }
    const manualBlocker = manualVoucherBlocker(
      manual.map((r) => ({
        account: r.account,
        costCenter: r.costCenterId,
        debit: r.debit,
        credit: r.credit,
      })),
      report.total,
    );
    if (manualBlocker) return fail(422, `income.manual.${manualBlocker}`);

    const clearing = clearingRow(report.total);
    lines = [
      ...manual.map((r, i) => ({
        account: r.account,
        accountName: r.accountName || (accountName.get(r.account) ?? ""),
        costCenterId: r.costCenterId,
        project: r.project,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        sortOrder: i,
      })),
      ...(clearing
        ? [
            {
              account: clearingAccount,
              accountName: accountName.get(clearingAccount) ?? "",
              costCenterId: null,
              ...clearing,
              sortOrder: manual.length,
            },
          ]
        : []),
    ];
    centreIds = manual.flatMap((r) => (r.costCenterId ? [r.costCenterId] : []));
  } else {
    const blocker = incomeVoucherBlocker(input);
    if (blocker) {
      // A fee line with no account is the fee setting left unchosen: name the setting.
      if (blocker === "noAccount" && report.lines.some((l) => l.kind === "FEE" && !l.account)) {
        return fail(409, "settings.zettleFeeAccountUnset");
      }
      return fail(422, `income.${blocker}`);
    }
    lines = buildDayVoucherLines(input);
    centreIds = report.lines.flatMap((l) =>
      l.total !== 0 && l.costCenterId ? [l.costCenterId] : [],
    );
  }

  // Every cost centre named must still exist and be in use, or Fortnox refuses the voucher at export.
  const centres = await prisma.costCenter.findMany({
    where: { id: { in: [...new Set(centreIds)] } },
    select: { id: true, code: true, source: true, active: true },
  });
  if (centres.length !== new Set(centreIds).size) return fail(422, "income.unknownCostCenter");
  const archived = centres.find((c) => !c.active);
  if (archived) return fail(422, "income.inactiveCostCenter", { values: { code: archived.code } });

  const imbalance = voucherBlocker(lines);
  if (imbalance) return fail(422, `voucher.${imbalance}`);

  // A local cost centre never reaches Fortnox as one, so its code goes into the row text (lib/domain/cost-center-tag).
  const centreById = new Map(centres.map((c) => [c.id, c]));
  const rowText = (costCenterId: string | null, text?: string | null) => {
    const cc = costCenterId ? centreById.get(costCenterId) : undefined;
    return cc && cc.source !== "FORTNOX" ? withCostCenterTag(text ?? "", cc.code) : text || null;
  };

  // ── The document ──

  // Booking is approving: the booker attests the stored document and is recorded as reviewer.
  const user = await loadUser(g.actor.id);
  if (!user) return fail(401, "auth.signedOut");

  const document = await storeIncomeDocument(report.id, {
    name: user.name,
    studentId: user.studentId,
  });
  if (!document.ok) {
    switch (document.reason) {
      case "reportNotFound":
        return fail(404, "income.reportNotFound");
      case "legacyReport":
        return fail(409, "income.reopenLegacy");
      case "renderFailed":
        return fail(502, "income.renderFailed", { values: { detail: document.detail } });
      case "storeFailed":
        return fail(502, "income.storeFailed");
    }
  }

  // ── Book ──

  await prisma.$transaction(async (tx) => {
    await tx.verification.create({
      data: {
        incomeReportId: report.id,
        date: report.date,
        description: incomeVoucherDescription(report.source),
        createdById: g.actor.id,
        lines: {
          create: lines.map((l) => ({
            account: l.account,
            accountName: l.accountName,
            costCenterId: l.costCenterId,
            project: l.project ?? null,
            description: rowText(l.costCenterId, l.description),
            debit: l.debit,
            credit: l.credit,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
    await tx.incomeReport.update({
      where: { id: report.id },
      data: { status: "BOOKED", reviewedById: g.actor.id, reviewedAt: new Date() },
    });
  });

  return NextResponse.json({ id: report.id, document: document.filename }, { status: 201 });
}
