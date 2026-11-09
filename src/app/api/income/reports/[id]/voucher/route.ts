// A day's hand-written kontering: save it, or go back to the rows the lines give
// (lib/income/manual-voucher.ts, used by ../book).
import { NextResponse } from "next/server";

import { fail, gate } from "@/lib/api/guard";
import { Prisma } from "@/lib/generated/prisma/client";
import { parseBody } from "@/lib/api/parse";
import { SaveIncomeVoucher } from "@/lib/api/schemas/income";
import { canBookkeep } from "@/lib/domain/permissions";
import { isLegacyReport } from "@/lib/income/legacy";
import {
  manualVoucherBlocker,
  voucherBasis,
  type ManualVoucherRow,
} from "@/lib/income/manual-voucher";
import { prisma } from "@/lib/server/db";

/** The day, if it may still have its kontering changed, or the answer to send. */
async function draft(id: string) {
  const report = await prisma.incomeReport.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      source: true,
      resultUnitId: true,
      total: true,
      lines: { select: { account: true, costCenterId: true, total: true } },
    },
  });
  if (!report) return { ok: false as const, res: fail(404, "income.reportNotFound") };
  if (report.status !== "DRAFT") {
    return {
      ok: false as const,
      res: fail(409, "income.editOnlyBeforeBooking", {
        values: { status: { key: `income.status.${report.status}` } },
      }),
    };
  }
  if (isLegacyReport(report)) return { ok: false as const, res: fail(409, "income.reopenLegacy") };
  return { ok: true as const, report };
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, SaveIncomeVoucher);
  if (!parsed.ok) return parsed.res;

  const found = await draft(id);
  if (!found.ok) return found.res;
  const { report } = found;

  // The editor's spare rows are not voucher rows.
  const lines = parsed.data.lines.filter((l) => l.account || l.debit || l.credit);

  // Every value must exist and be in use, or Fortnox refuses the voucher at export.
  const accounts = [...new Set(lines.map((l) => l.account).filter(Boolean))];
  const known = await prisma.account.findMany({
    where: { number: { in: accounts } },
    select: { number: true, name: true },
  });
  const accountName = new Map(known.map((a) => [a.number, a.name]));
  const unknownAccount = accounts.find((a) => !accountName.has(a));
  if (unknownAccount) {
    return fail(422, "income.unknownAccount", { values: { account: unknownAccount } });
  }

  const codes = [...new Set(lines.map((l) => l.costCenterCode).filter(Boolean))] as string[];
  const centres = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
  const centreByCode = new Map(centres.map((c) => [c.code, c]));
  const unknownCode = codes.find((c) => !centreByCode.has(c));
  if (unknownCode) return fail(422, "voucher.unknownCostCenter", { values: { code: unknownCode } });
  const archived = centres.find((c) => !c.active);
  if (archived) return fail(422, "income.inactiveCostCenter", { values: { code: archived.code } });

  const numbers = [...new Set(lines.map((l) => l.project).filter(Boolean))] as string[];
  if (numbers.length > 0) {
    const have = new Set(
      (
        await prisma.project.findMany({
          where: { number: { in: numbers } },
          select: { number: true },
        })
      ).map((p) => p.number),
    );
    const missing = numbers.find((n) => !have.has(n));
    if (missing) return fail(422, "voucher.unknownProject", { values: { project: missing } });
  }

  const blocker = manualVoucherBlocker(
    lines.map((l) => ({
      account: l.account,
      costCenter: l.costCenterCode || null,
      debit: l.debit,
      credit: l.credit,
    })),
    report.total,
  );
  if (blocker) return fail(422, `income.manual.${blocker}`);

  const rows: ManualVoucherRow[] = lines.map((l) => {
    const cc = l.costCenterCode ? centreByCode.get(l.costCenterCode)! : null;
    return {
      account: l.account,
      accountName: accountName.get(l.account) ?? "",
      costCenterId: cc?.id ?? null,
      costCenterCode: cc?.code ?? null,
      project: l.project || null,
      description: l.description || null,
      debit: l.debit,
      credit: l.credit,
    };
  });

  await prisma.incomeReport.update({
    where: { id },
    data: {
      manualVoucher: rows as unknown as Prisma.InputJsonValue,
      manualVoucherBasis: voucherBasis(report.lines, report.total),
      manualVoucherById: g.actor.id,
      manualVoucherAt: new Date(),
    },
  });

  return NextResponse.json({ id, rows: rows.length });
}

/** Back to the rows the lines give. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canBookkeep, "auth.denied");
  if (!g.ok) return g.res;

  const found = await draft(id);
  if (!found.ok) return found.res;

  await prisma.incomeReport.update({
    where: { id },
    data: {
      manualVoucher: Prisma.DbNull,
      manualVoucherBasis: null,
      manualVoucherById: null,
      manualVoucherAt: null,
    },
  });
  return NextResponse.json({ id, reset: true });
}
