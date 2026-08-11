// Book a day's takings: store the intäktsräkning, then write the verifikation.
//
// Two ways in, and the difference is only where the rows come from. With no
// lines in the body the app derives them from the day's account distributions —
// what "book all" sends, and what nearly every day needs. With lines, they are
// the ones the bookkeeper edited on the booking screen, held to the same rules
// as an utlägg's voucher plus one of its own: the debit side has to come to the
// day's total, because the document beside it says so.
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
import { parseBody } from "@/lib/api/parse";
import { BookIncomeReport } from "@/lib/api/schemas/income";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import { voucherBlocker } from "@/lib/domain/voucher";
import { storeIncomeDocument } from "@/lib/income/document";
import { toFeeReportDto, toReportDto } from "@/lib/income/report";
import {
  buildFeeVoucherLines,
  buildIncomeVoucherLines,
  incomeVoucherBlocker,
  incomeVoucherDescription,
  type IncomeVoucherLine,
} from "@/lib/income/voucher";
import { loadUser } from "@/lib/server/current-user";
import { prisma } from "@/lib/server/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const g = await gate(canAccessBookkeeping, "auth.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, BookIncomeReport);
  if (!parsed.ok) return parsed.res;
  const edited = parsed.data.lines;

  const report = await prisma.incomeReport.findUnique({
    where: { id },
    include: {
      // The unit, and the income settings that say what its voucher is called.
      resultUnit: { include: { income: true } },
      costCenter: true,
      lines: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!report) return fail(404, "income.reportNotFound");

  if (report.status !== "DRAFT") {
    return fail(409, "income.bookOnlyDraft", {
      values: { status: { key: `income.status.${report.status}` } },
    });
  }

  const settings = await prisma.bookkeepingSettings.findUnique({ where: { id: "singleton" } });
  const accounts = await prisma.account.findMany({ select: { number: true, name: true } });
  const accountName = new Map(accounts.map((a) => [a.number, a.name]));
  const nameFor = (n: string) => accountName.get(n) ?? "";

  const isFee = report.source === "ZETTLE_FEE";

  // Where this day's revenue is booked. The report's own cost centre is the
  // decision — the import copies the committee's default onto it and review may
  // have changed it since — but a day fetched before the committee had a
  // default carries none, and the answer is sitting in the settings. The
  // booking screen pre-fills from the same three, in this order, so a day
  // booked without anyone touching it gets exactly what it showed.
  const costCenterId =
    report.costCenterId ??
    (isFee
      ? (settings?.zettleFeeCostCenterId ?? null)
      : (report.resultUnit?.income?.defaultCostCenterId ?? null));

  const clearingAccount = isFee
    ? (settings?.zettleClearingAccount ?? "1930")
    : report.source === "SWISH"
      ? (settings?.swishClearingAccount ?? "1931")
      : (settings?.zettleClearingAccount ?? "1930");

  // ── The voucher, decided before anything is stored or written ──

  let lines: IncomeVoucherLine[];
  if (edited.length > 0) {
    // Edited on the booking screen. Cost centres arrive as codes, the way the
    // utlägg voucher sends them, because a code is what the bookkeeper picked
    // and what the ledger reads — so they are resolved to ids here, and an
    // unknown one is refused rather than booked as no cost centre at all.
    const codes = [...new Set(edited.map((l) => l.costCenterCode).filter(Boolean))] as string[];
    const centres = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
    const idByCode = new Map(centres.map((c) => [c.code, c.id]));
    const unknown = codes.find((c) => !idByCode.has(c));
    if (unknown) return fail(422, "voucher.unknownCostCenter", { values: { code: unknown } });

    lines = edited
      .filter((l) => l.account || l.debit || l.credit)
      .map((l, i) => ({
        account: l.account,
        accountName: l.accountName || nameFor(l.account),
        costCenterId: l.costCenterCode ? (idByCode.get(l.costCenterCode) ?? null) : null,
        debit: l.debit,
        credit: l.credit,
        sortOrder: i,
      }));

    // The one rule an utlägg's voucher does not have. The intäktsräkning beside
    // this table states the day's total; a voucher that books a different figure
    // would be a verifikation and its own evidence disagreeing, which is the
    // thing the whole review step exists to prevent. Compared on the debit side
    // because the voucher balances by the time this runs, and against the
    // magnitude because a day of net refunds runs the other way round.
    const debit = lines.reduce((sum, l) => sum + l.debit, 0);
    if (debit !== Math.abs(report.total)) {
      return fail(422, "income.voucherTotalMismatch");
    }
  } else if (isFee) {
    const feeAccount = settings?.zettleFeeAccount ?? "6570";
    if (!costCenterId) return fail(422, "income.costCenterRequired");
    lines = buildFeeVoucherLines({
      report: toFeeReportDto(report),
      feeAccount,
      feeAccountName: nameFor(feeAccount),
      clearingAccount,
      clearingAccountName: nameFor(clearingAccount),
      costCenterId,
    });
  } else {
    const dto = toReportDto(report);
    const blocker = incomeVoucherBlocker({
      distributions: dto.accountDistributions,
      total: report.total,
      clearingAccount,
      clearingAccountName: nameFor(clearingAccount),
      costCenterId,
      accountName: nameFor,
    });
    if (blocker) return fail(422, `income.${blocker}`);

    lines = buildIncomeVoucherLines({
      distributions: dto.accountDistributions,
      total: report.total,
      clearingAccount,
      clearingAccountName: nameFor(clearingAccount),
      costCenterId,
      accountName: nameFor,
    });
  }

  // The same rule the expense booking screen is held to. Reaching this with an
  // unbalanced voucher would mean a bug above, not bad input — but a voucher
  // that does not balance must not reach the database either way.
  const imbalance = voucherBlocker(lines);
  if (imbalance) return fail(422, `voucher.${imbalance}`);

  // ── The document ──

  // The signed-in user is only the fallback attestation, for a batch whose
  // importer is no longer in the app: the report is attested by whoever fetched
  // it, and by now it usually carries their name already.
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
      case "serviceUnavailable":
        return fail(503, "income.serviceUnavailable");
      case "noAttestation":
        return fail(409, "income.noAttestation");
      case "config":
        return fail(409, `income.${document.blocker}`, {
          ...(document.detail && { values: { detail: document.detail } }),
        });
      case "renderFailed":
        return fail(502, "income.renderFailed", { values: { detail: document.detail } });
      case "storeFailed":
        return fail(502, "income.storeFailed");
    }
  }

  // ── Book ──

  // The unit's income text, or its plain name if its income settings have since
  // been removed — a booked day must still say whose takings it was.
  const description = incomeVoucherDescription(
    report.source,
    report.resultUnit?.income?.description ?? report.resultUnit?.name ?? null,
  );

  // What the day ends up recorded as booking against.
  //
  // Written back rather than left as it was, for two reasons. A voucher edited
  // on the way past — the ordinary way to correct a reopened day — used to
  // change the verifikation and nothing else, so the queue, the booked list and
  // the next reopen all went on showing the cost centre the day *had*, while
  // the ledger held the one it was actually booked with. And a day that fell
  // back to its verksamhet's default (see `costCenterId` above) carried none of
  // its own, which made it depend on a setting that may be changed afterwards.
  //
  // Only when the voucher agrees with itself: rows deliberately split across
  // several cost centres have no single answer, and inventing one would be
  // worse than leaving the field as it stands.
  const used = [...new Set(lines.flatMap((l) => (l.costCenterId ? [l.costCenterId] : [])))];
  const booked = used.length === 1 ? used[0] : null;

  await prisma.$transaction(async (tx) => {
    await tx.verification.create({
      data: {
        incomeReportId: report.id,
        date: report.date,
        description,
        createdById: g.actor.id,
        lines: {
          create: lines.map((l) => ({
            account: l.account,
            accountName: l.accountName,
            costCenterId: l.costCenterId,
            debit: l.debit,
            credit: l.credit,
            sortOrder: l.sortOrder,
          })),
        },
      },
    });
    // The document keys are already on the row — ensureIncomeDocument wrote
    // them when it rendered, or found them there.
    await tx.incomeReport.update({
      where: { id: report.id },
      data: { status: "BOOKED", ...(booked && { costCenterId: booked }) },
    });
  });

  return NextResponse.json({ id: report.id, document: document.filename }, { status: 201 });
}
