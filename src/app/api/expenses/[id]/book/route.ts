// Book an approved expense (POST) or amend a booked voucher before export (PATCH). The shared work is below.
// Two bookkeepers can have the same utlägg open (lib/domain/presence.ts): each write restates the version its screen showed,
// and each transaction starts with a conditional update on the utlägg that takes its row lock, so the loser gets a 409.
// The voucher's date is the utlägg's date. Booking on another day corrects the utlägg, with a reason (lib/domain/correction.ts).
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { loadBookkeepingSettings } from "@/lib/server/bookkeeping-settings";
import type { Prisma } from "@/lib/generated/prisma/client";
import { canBookkeep } from "@/lib/domain/permissions";
import { isRevenueAccount, voucherBlocker } from "@/lib/domain/voucher";
import type { PaymentType } from "@/lib/domain/types";
import { fail, gate } from "@/lib/api/guard";
import { StaleWrite, applied, commit } from "@/lib/api/stale-write";
import { exportLock } from "@/lib/domain/export-claim";
import { CLEARED } from "@/lib/server/export-claim";
import { denyOutsideFiscalYear } from "@/lib/api/fiscal-year";
import { parseBody } from "@/lib/api/parse";
import { BookVoucher } from "@/lib/api/schemas/expense";
import { isFutureDate, isoDay } from "@/lib/domain/date";
import type { CorrectionDiff } from "@/lib/domain/correction";
import { valueForStorage } from "@/lib/mileage/store";

interface NormLine {
  account: string;
  accountName: string;
  description: string | null;
  costCenterCode: string | null;
  project: string | null;
  debit: number; // öre
  credit: number; // öre
}

// Validate the voucher lines: each row needs an account and the verification must balance. Shapes are the schema's.
function prepareLines(
  body: BookVoucher,
): { ok: true; lines: NormLine[] } | { ok: false; error: string; status: number } {
  const lines: NormLine[] = body.lines
    .map((l) => ({
      account: l.account,
      accountName: l.accountName,
      description: l.description || null,
      costCenterCode: l.costCenterCode ?? null,
      project: l.project ?? null,
      debit: l.debit,
      credit: l.credit,
    }))
    .filter((l) => l.account || l.debit || l.credit);

  // The rule is in lib/domain/voucher.ts, so the booking screen gets the same answer.
  const blocker = voucherBlocker(lines);
  if (blocker) return { ok: false, error: `voucher.${blocker}`, status: 422 };
  return { ok: true, lines };
}

// The first row on an intäktskonto, if any. See isRevenueAccount.
function revenueLine(lines: NormLine[]): NormLine | undefined {
  return lines.find((l) => isRevenueAccount(l.account));
}

// The first project number no synced project has. Fortnox would reject the voucher on export, so it is refused at booking.
// Closed projects still count (getActiveProjects).
async function unknownProject(lines: NormLine[]): Promise<string | undefined> {
  const numbers = [...new Set(lines.map((l) => l.project).filter(Boolean))] as string[];
  if (numbers.length === 0) return undefined;
  const known = await prisma.project.findMany({
    where: { number: { in: numbers } },
    select: { number: true },
  });
  const have = new Set(known.map((p) => p.number));
  return numbers.find((n) => !have.has(n));
}

// The payment row is not the bookkeeper's to choose: a card purchase already left the section's bank, a private outlay is a debt
// to the member. The client is a convenience, not the gate. Milersättning falls on the member-debt side: only the card was paid by the section.
async function checkPaymentLine(
  lines: NormLine[],
  expense: { paymentType: PaymentType; grossAmount: number | null },
): Promise<{ code: string; account: string } | null> {
  const settings = await loadBookkeepingSettings();
  const account =
    expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
  // Not chosen yet, so there is no payment row to book.
  if (!account) {
    return {
      code:
        expense.paymentType === "CARD"
          ? "settings.bankAccountUnset"
          : "settings.memberDebtAccountUnset",
      account: "",
    };
  }

  const onAccount = lines.filter((l) => l.account === account);
  if (onAccount.length !== 1) {
    return { code: "voucher.onePaymentLine", account };
  }
  const [payment] = onAccount;
  if (payment.costCenterCode) {
    return { code: "voucher.paymentLineNoCostCenter", account };
  }
  // A return (negative gross) is the same row the other way round: the money
  // comes back in, so the account is debited with the magnitude.
  const gross = expense.grossAmount ?? 0;
  const expected = gross < 0 ? { debit: -gross, credit: 0 } : { debit: 0, credit: gross };
  if (payment.debit !== expected.debit || payment.credit !== expected.credit) {
    return { code: "voucher.paymentLineFullAmount", account };
  }
  return null;
}

/** Resolve the cost-center codes to ids, or name the first one that isn't a cost centre.
 * A line without one would vanish from the budget-vs-actual side. */
async function costCenterIdByCode(
  lines: NormLine[],
): Promise<{ ok: true; idByCode: Map<string, string> } | { ok: false; code: string }> {
  const codes = [...new Set(lines.map((l) => l.costCenterCode).filter(Boolean))] as string[];
  const ccs = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
  const idByCode = new Map(ccs.map((c) => [c.code, c.id]));
  // Inactive ones still resolve: an amended voucher may be posted against a since-retired centre.
  const unknown = codes.find((c) => !idByCode.has(c));
  return unknown ? { ok: false, code: unknown } : { ok: true, idByCode };
}

// The rows as Prisma nested-create data, identical for creating and replacing.
const voucherLineData = (lines: NormLine[], idByCode: Map<string, string>) =>
  lines.map((l, i) => ({
    account: l.account,
    accountName: l.accountName,
    description: l.description,
    costCenterId: l.costCenterCode ? (idByCode.get(l.costCenterCode) ?? null) : null,
    project: l.project,
    debit: l.debit,
    credit: l.credit,
    sortOrder: i,
  }));

// Authority + the expense: bookkeepers only. The status checks below say which utlägg, never who.
async function loadForBooking(id: string) {
  const g = await gate(canBookkeep, "auth.bookkeeperBook");
  if (!g.ok) return { ok: false as const, res: g.res };

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { verification: true, exportClaimedBy: { select: { name: true } } },
  });
  if (!expense) return { ok: false as const, res: fail(404, "expense.notFound") };
  return { ok: true as const, actor: g.actor, expense };
}

async function prepareVoucher(
  body: BookVoucher,
  expense: { paymentType: PaymentType; grossAmount: number | null },
) {
  const prepared = prepareLines(body);
  if (!prepared.ok) return { ok: false as const, res: fail(prepared.status, prepared.error) };

  const revenue = revenueLine(prepared.lines);
  if (revenue) {
    return {
      ok: false as const,
      res: fail(422, "voucher.revenueAccount", { values: { account: revenue.account } }),
    };
  }

  const paymentError = await checkPaymentLine(prepared.lines, expense);
  if (paymentError) {
    return {
      ok: false as const,
      res: fail(422, paymentError.code, { values: { account: paymentError.account } }),
    };
  }

  const resolved = await costCenterIdByCode(prepared.lines);
  if (!resolved.ok) {
    return {
      ok: false as const,
      res: fail(422, "voucher.unknownCostCenter", { values: { code: resolved.code } }),
    };
  }

  const project = await unknownProject(prepared.lines);
  if (project) {
    return {
      ok: false as const,
      res: fail(422, "voucher.unknownProject", { values: { project } }),
    };
  }

  return {
    ok: true as const,
    lines: prepared.lines,
    idByCode: resolved.idByCode,
  };
}

function voucherMeta(body: BookVoucher, fallback: { date: Date; description: string }) {
  return {
    date: body.date ? new Date(body.date) : fallback.date,
    description: body.description || fallback.description,
  };
}

type ForBooking = Extract<Awaited<ReturnType<typeof loadForBooking>>, { ok: true }>["expense"];

/** What the voucher's date does to the utlägg's own. Same day: nothing. No date at all: it takes the voucher's.
 * Any other day is a correction and needs a reason. Held to not in the future. On a milersättning the date picks
 * the schablon, so a correction across a rate change goes back to the submitter. */
async function dateCorrection(
  expense: ForBooking,
  date: Date,
  reason: string | undefined,
): Promise<
  | { ok: false; res: NextResponse }
  | { ok: true; setDate: boolean; correction: CorrectionDiff | null }
> {
  const from = expense.purchaseDate ? isoDay(expense.purchaseDate) : null;
  const to = isoDay(date);
  if (from === to) return { ok: true, setDate: false, correction: null };
  if (from === null) return { ok: true, setDate: true, correction: null };

  if (!reason) return { ok: false, res: fail(422, "expense.correctionReasonRequired") };
  if (isFutureDate(to)) return { ok: false, res: fail(422, "expense.futureDate") };
  if (expense.paymentType === "MILEAGE") {
    const valued = await valueForStorage({
      date: to,
      odometerStart: expense.odometerStart == null ? null : Number(expense.odometerStart),
      odometerEnd: expense.odometerEnd == null ? null : Number(expense.odometerEnd),
    });
    if (valued.orePerKm !== expense.mileageOrePerKm) {
      return { ok: false, res: fail(422, "expense.correctionChangesMileageRate") };
    }
  }
  return { ok: true, setDate: true, correction: { field: "purchaseDate", from, to } };
}

async function recordDateCorrection(
  tx: Prisma.TransactionClient,
  expense: ForBooking,
  actor: { id: string },
  correction: CorrectionDiff,
  reason: string,
) {
  await tx.expenseEvent.create({
    data: {
      expenseId: expense.id,
      type: "CORRECTED",
      actorId: actor.id,
      comment: reason,
      diff: { ...correction },
    },
  });
}

// A verification already exists: the backstop for a row that reached BOOKED some other way, a 409 instead of the unique index as a 500.
// Duck-typed on Prisma's error code, as in lib/server/expense-reference.ts.
function alreadyBooked(err: unknown): never {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
    throw new StaleWrite();
  }
  throw err;
}

async function newVersion(tx: Prisma.TransactionClient, id: string): Promise<string> {
  const row = await tx.expense.findUniqueOrThrow({ where: { id }, select: { updatedAt: true } });
  return row.updatedAt.toISOString();
}

// POST: create the voucher for an APPROVED expense and flip it to BOOKED.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadForBooking(id);
  if (!loaded.ok) return loaded.res;
  const { actor, expense } = loaded;

  if (expense.status !== "APPROVED") {
    return fail(409, "expense.bookOnlyApproved", {
      values: { status: { key: `common.status.${expense.status}` } },
    });
  }

  const parsed = await parseBody(req, BookVoucher);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const voucher = await prepareVoucher(body, expense);
  if (!voucher.ok) return voucher.res;

  // The day of the purchase, not of booking (wrong month or financial year otherwise). Today only when the utlägg carries no date, which older rows can.
  const { date, description } = voucherMeta(body, {
    date: expense.purchaseDate ?? new Date(),
    description: expense.title,
  });
  // A new voucher, so in the year picked in the header. See lib/api/fiscal-year.ts.
  const offYear = await denyOutsideFiscalYear(date);
  if (offYear) return offYear;
  const dated = await dateCorrection(expense, date, body.correctionReason);
  if (!dated.ok) return dated.res;

  const expected = new Date(body.expectedUpdatedAt);
  const done = await commit(() =>
    prisma.$transaction(async (tx) => {
      // First, and conditional: see the top of the file.
      const flipped = await tx.expense.updateMany({
        where: { id: expense.id, status: "APPROVED", updatedAt: expected },
        // The version moves on explicitly, so a screen open on the old one learns it was booked.
        data: {
          status: "BOOKED",
          updatedAt: new Date(),
          ...(dated.setDate && { purchaseDate: date }),
        },
      });
      applied(flipped);
      if (dated.correction) {
        await recordDateCorrection(tx, expense, actor, dated.correction, body.correctionReason!);
      }
      await tx.verification
        .create({
          data: {
            expenseId: expense.id,
            date,
            description,
            createdById: actor.id,
            lines: { create: voucherLineData(voucher.lines, voucher.idByCode) },
          },
        })
        .catch(alreadyBooked);
      await tx.expenseEvent.create({
        data: { expenseId: expense.id, type: "BOOKED", actorId: actor.id },
      });
      return newVersion(tx, expense.id);
    }),
  );
  if (done instanceof NextResponse) return done;

  return NextResponse.json({ id, updatedAt: done }, { status: 201 });
}

// PATCH: amend the konteringsrader of a BOOKED (not yet EXPORTED) verification.
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadForBooking(id);
  if (!loaded.ok) return loaded.res;
  const { actor, expense } = loaded;

  if (expense.status !== "BOOKED") {
    return expense.status === "EXPORTED"
      ? fail(409, "expense.voucherExported")
      : fail(409, "expense.amendOnlyBooked", {
          values: { status: { key: `common.status.${expense.status}` } },
        });
  }
  // Not while being exported: an amend in between would file the old voucher in Fortnox and record the new one here.
  const lock = exportLock(expense.exportClaimState, expense.exportClaimedAt, Date.now());
  if (lock !== "free") {
    return fail(
      409,
      lock === "exporting" ? "expense.exportInProgress" : "expense.exportUncertain",
      {
        values: { name: expense.exportClaimedBy?.name ?? "-" },
      },
    );
  }
  const verification = expense.verification;
  if (!verification) throw new Error(`Expense ${id} is BOOKED but has no verification`);

  const parsed = await parseBody(req, BookVoucher);
  if (!parsed.ok) return parsed.res;
  const body = parsed.data;
  const voucher = await prepareVoucher(body, expense);
  if (!voucher.ok) return voucher.res;

  const { date, description } = voucherMeta(body, verification);
  // Only a date this amend moves: a voucher already in another year can still
  // have its rows corrected.
  if (body.date && date.getTime() !== verification.date.getTime()) {
    const offYear = await denyOutsideFiscalYear(date);
    if (offYear) return offYear;
  }
  const dated = await dateCorrection(expense, date, body.correctionReason);
  if (!dated.ok) return dated.res;

  const expected = new Date(body.expectedUpdatedAt);
  const done = await commit(() =>
    prisma.$transaction(async (tx) => {
      // First, and conditional (see the top of the file). The utlägg's version is bumped by hand, which also catches an export that got there first
      // and clears a lock abandoned before it sent anything, so a slow exporter finds it gone and sends nothing.
      const bumped = await tx.expense.updateMany({
        where: { id: expense.id, status: "BOOKED", updatedAt: expected },
        data: {
          updatedAt: new Date(),
          ...CLEARED,
          ...(dated.setDate && { purchaseDate: date }),
        },
      });
      applied(bumped);
      if (dated.correction) {
        await recordDateCorrection(tx, expense, actor, dated.correction, body.correctionReason!);
      }
      // Replace all lines in place (verification stays, only its rows change).
      await tx.verification.update({
        where: { expenseId: expense.id },
        data: {
          date,
          description,
          lines: {
            deleteMany: {},
            create: voucherLineData(voucher.lines, voucher.idByCode),
          },
        },
      });
      await tx.expenseEvent.create({
        data: {
          expenseId: expense.id,
          type: "EDITED",
          actorId: actor.id,
          comment: "",
        },
      });
      return newVersion(tx, expense.id);
    }),
  );
  if (done instanceof NextResponse) return done;

  return NextResponse.json({ id, updatedAt: done }, { status: 200 });
}
