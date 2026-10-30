// Book an approved expense (POST) or amend a booked voucher before export
// (PATCH). The [id] param is the expense id.
//
// Both handlers do the same work on the same rows and differ only in which
// status they accept and whether the verification is created or replaced, so
// everything up to that point is shared below.
//
// Two bookkeepers can have the same utlägg open at once (the booking screen
// says so, see lib/domain/presence.ts, but saying so is not stopping it). So
// each write restates the version the screen was showing, and the first
// statement of each transaction is a conditional update on the utlägg that
// takes its row lock. A second booking of the same utlägg waits on that lock,
// finds the row moved on once it gets it, and is a 409. It used to reach the
// unique index on Verification.expenseId and come back as a 500, and a second
// amend used to simply win.
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

interface NormLine {
  account: string;
  accountName: string;
  description: string | null;
  costCenterCode: string | null;
  project: string | null;
  debit: number; // öre
  credit: number; // öre
}

// Validate the voucher lines: each row needs an account, and the verification
// must balance (debit total == credit total). The *shapes* (strings that are
// strings, amounts that are non-negative integer öre) are the schema's, and
// are not re-checked here. A number that arrived as nonsense used to become 0
// through `Number(x) || 0` and quietly unbalance the voucher.
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

  // The rule itself is in lib/domain/voucher.ts, so the booking screen can
  // apply it before offering the button and get the same answer.
  const blocker = voucherBlocker(lines);
  if (blocker) return { ok: false, error: `voucher.${blocker}`, status: 422 };
  return { ok: true, lines };
}

// The first row on an intäktskonto, if any. See isRevenueAccount.
function revenueLine(lines: NormLine[]): NormLine | undefined {
  return lines.find((l) => isRevenueAccount(l.account));
}

// The first project number no synced project has, if any. Fortnox would reject
// the whole voucher on export for it, so it is refused here, at booking, where
// it can still be fixed. Closed projects still count: see getActiveProjects.
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

// The payment row is not the bookkeeper's to choose: a card purchase already
// left the section's bank, a private outlay is a debt to the member. The UI
// renders that row as fixed, and this is the same rule on the server. The
// client is a convenience, not the gate.
//
// Milersättning falls on the member-debt side without a branch of its own, and
// that is the right answer rather than a lucky one: the section owes the
// claimant their petrol exactly as it owes them a receipt they paid. The test
// is "did the section's own account already pay for this", which only the card
// answers yes to.
async function checkPaymentLine(
  lines: NormLine[],
  expense: { paymentType: PaymentType; grossAmount: number | null },
): Promise<{ code: string; account: string } | null> {
  const settings = await loadBookkeepingSettings();
  const account = expense.paymentType === "CARD" ? settings.bankAccount : settings.memberDebtAccount;
  // Not chosen yet, so there is no payment row to book. Said as such, rather
  // than as a voucher that is somehow missing its payment line.
  if (!account) {
    return {
      code:
        expense.paymentType === "CARD" ? "settings.bankAccountUnset" : "settings.memberDebtAccountUnset",
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

/**
 * Resolve the cost-center codes used by the lines to their ids, or name the
 * first one that isn't a cost centre.
 *
 * A code that resolves to nothing used to be booked as no cost centre at all:
 * the voucher balanced, the accounts were right, and the line simply carried no
 * kostnadsställe. That is the one field the whole budget-vs-actual side of the
 * app reads. A verification posted without it is money that has left the
 * section and appears in nobody's outcome. PATCH /api/expenses/[id] refuses an
 * unknown code on an allocation; there is no reason the voucher itself should
 * be the laxer of the two.
 */
async function costCenterIdByCode(
  lines: NormLine[],
): Promise<{ ok: true; idByCode: Map<string, string> } | { ok: false; code: string }> {
  const codes = [...new Set(lines.map((l) => l.costCenterCode).filter(Boolean))] as string[];
  const ccs = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
  const idByCode = new Map(ccs.map((c) => [c.code, c.id]));
  // Inactive ones still resolve: a retired cost centre is one nothing new
  // should be *allocated* to, but a voucher being amended may well be posted
  // against the one it was always posted against.
  const unknown = codes.find((c) => !idByCode.has(c));
  return unknown ? { ok: false, code: unknown } : { ok: true, idByCode };
}

// The rows as Prisma nested-create data. Identical for creating and replacing,
// which is the whole reason it is a function.
const voucherLineData = (lines: NormLine[], idByCode: Map<string, string>) =>
  lines.map((l, i) => ({
    account: l.account,
    accountName: l.accountName,
    description: l.description,
    costCenterId: l.costCenterCode ? idByCode.get(l.costCenterCode) ?? null : null,
    project: l.project,
    debit: l.debit,
    credit: l.credit,
    sortOrder: i,
  }));

// Authority + the expense. Booking creates a verification in the section's
// books, so it is bookkeepers only. The status checks below say *which*
// utlägg, never *who*.
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

// The rows, validated against the utlägg they belong to.
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

// The verification's date and heading. The caller may set both, and each falls
// back to what the utlägg already says.
function voucherMeta(
  body: BookVoucher,
  fallback: { date: Date; description: string },
) {
  return {
    date: body.date ? new Date(body.date) : fallback.date,
    description: body.description || fallback.description,
  };
}

// A verification for this utlägg already exists. The conditional update above
// is what normally answers a second booking, so this is the backstop for a row
// that reached BOOKED some other way: the same answer, a 409, rather than the
// unique index surfacing as a 500. Duck-typed on Prisma's public error code, as
// in lib/server/expense-reference.ts.
function alreadyBooked(err: unknown): never {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002") {
    throw new StaleWrite();
  }
  throw err;
}

// The utlägg's version as this write left it, for the screen that made it.
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

  // The day of the purchase, not the day somebody got round to booking it. A
  // voucher dated today for a receipt from March puts the cost in the wrong
  // month, and in January it puts it in the wrong financial year.
  //
  // Today only when the utlägg carries no date at all, which the submission
  // form does not allow but older rows can still hold. There is nothing better
  // to reach for in that case, and refusing to book would strand the utlägg.
  const { date, description } = voucherMeta(body, {
    date: expense.purchaseDate ?? new Date(),
    description: expense.title,
  });
  // A new voucher, so in the year picked in the header. See lib/api/fiscal-year.ts.
  const offYear = await denyOutsideFiscalYear(date);
  if (offYear) return offYear;

  const expected = new Date(body.expectedUpdatedAt);
  const done = await commit(() =>
    prisma.$transaction(async (tx) => {
      // First, and conditional: see the top of the file.
      const flipped = await tx.expense.updateMany({
        where: { id: expense.id, status: "APPROVED", updatedAt: expected },
        // The version moves on explicitly. A screen still open on the old one
        // learns from it that this utlägg was booked.
        data: { status: "BOOKED", updatedAt: new Date() },
      });
      applied(flipped);
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
  // Not while it is being exported. The export reads these rows to send them,
  // and an amend landing in between would file the old voucher in Fortnox
  // while this app records the new one.
  const lock = exportLock(expense.exportClaimState, expense.exportClaimedAt, Date.now());
  if (lock !== "free") {
    return fail(409, lock === "exporting" ? "expense.exportInProgress" : "expense.exportUncertain", {
      values: { name: expense.exportClaimedBy?.name ?? "-" },
    });
  }
  // BOOKED, checked above, is the status konteringen sets with its voucher.
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

  const expected = new Date(body.expectedUpdatedAt);
  const done = await commit(() =>
    prisma.$transaction(async (tx) => {
      // First, and conditional: see the top of the file. The verification is
      // not the utlägg, so the utlägg's version is bumped by hand to say that
      // its voucher changed. It is also what catches an export that got there
      // first, since that moves the status on.
      //
      // The version check also covers the export lock: taking it bumps the
      // version. A lock abandoned before it sent anything (the only kind the
      // check above lets through) is cleared, so the export that left it, if it
      // is only slow rather than gone, finds it gone and sends nothing.
      const bumped = await tx.expense.updateMany({
        where: { id: expense.id, status: "BOOKED", updatedAt: expected },
        data: { updatedAt: new Date(), ...CLEARED },
      });
      applied(bumped);
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
