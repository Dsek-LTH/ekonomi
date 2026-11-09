// Book a day's takings: store the intäktsräkning, then write the verifikation.
//
// The voucher is derived from the day's lines: one row per account and cost
// centre, then the clearing account (lib/income/voucher.ts). Or, when somebody
// has written the kontering by hand, those rows, saved on the report with a
// fingerprint of the lines they were written against
// (lib/income/manual-voucher.ts). A hand-written kontering whose lines have
// changed since is refused, so it can never outlive a correction unnoticed.
//
// Storing the document happens here, and only here. A draft is rendered on
// demand and kept by nobody; the moment a day is booked, the PDF becomes the
// evidence behind a figure in the ledger and has to be the same bytes forever
// (lib/income/document.ts).
//
// The order matters. The PDF is stored *before* the verifikation exists,
// because a stored object with no voucher pointing at it is rubbish that a
// sweep can collect, whereas a voucher with no document is a booked figure with
// nothing substantiating it.
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
  // A reopened day from before the per-day voucher. Reopening one is refused
  // (lib/income/lifecycle.ts), so this is a guard, not a path.
  if (isLegacyReport(report) || report.source === "ZETTLE_FEE") {
    return fail(409, "income.reopenLegacy");
  }
  // Some of this day's money is already booked here. The partial unique index
  // would refuse a second verifikation anyway; this says it as a sentence.
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

  // A sale nobody has given a verksamhet. Only possible when the routing table
  // changed under a fetch, but booking it would be takings that are nobody's.
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

  // A kontering written by hand is booked as written, provided the lines are
  // still the ones it was written against. Otherwise the rows the lines give.
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
      // A fee line with no account is the fee setting left unchosen, which is
      // fixed in the settings rather than on the day, so it says which setting.
      if (blocker === "noAccount" && report.lines.some((l) => l.kind === "FEE" && !l.account)) {
        return fail(409, "settings.zettleFeeAccountUnset");
      }
      return fail(422, `income.${blocker}`);
    }
    lines = buildDayVoucherLines(input);
    centreIds = report.lines.flatMap((l) => (l.total !== 0 && l.costCenterId ? [l.costCenterId] : []));
  }

  // Every cost centre the voucher names has to still exist and be in use. An
  // archived one would have the whole voucher refused by Fortnox at export,
  // long after this said it was booked. Refused here instead, where it can
  // still be changed.
  const centres = await prisma.costCenter.findMany({
    where: { id: { in: [...new Set(centreIds)] } },
    select: { id: true, code: true, source: true, active: true },
  });
  if (centres.length !== new Set(centreIds).size) return fail(422, "income.unknownCostCenter");
  const archived = centres.find((c) => !c.active);
  if (archived) return fail(422, "income.inactiveCostCenter", { values: { code: archived.code } });

  const imbalance = voucherBlocker(lines);
  if (imbalance) return fail(422, `voucher.${imbalance}`);

  // A local cost centre never reaches Fortnox as one, so its code goes into
  // the row text, the same as on an utlägg's voucher (lib/domain/cost-center-tag).
  // Written now rather than only at export, so the verifikation reads here
  // exactly as it will over there.
  const centreById = new Map(centres.map((c) => [c.id, c]));
  const rowText = (costCenterId: string | null, text?: string | null) => {
    const cc = costCenterId ? centreById.get(costCenterId) : undefined;
    return cc && cc.source !== "FORTNOX" ? withCostCenterTag(text ?? "", cc.code) : text || null;
  };

  // ── The document ──

  // Booking is approving. The day has been reviewed against its intäktsräkning
  // by the person booking it, so the stored document is attested by them and
  // the day records them as its reviewer (below).
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
