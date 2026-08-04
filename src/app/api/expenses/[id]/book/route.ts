// Book an approved expense (POST) or amend a booked voucher before export
// (PATCH). The [id] param is the expense id.
//
// Both handlers do the same work on the same rows and differ only in which
// status they accept and whether the verification is created or replaced, so
// everything up to that point is shared below.
import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/db";
import { canBookkeep } from "@/lib/domain/permissions";
import { voucherBlocker } from "@/lib/domain/voucher";
import { fail, gate } from "@/lib/api/guard";

interface LineInput {
  account?: string;
  accountName?: string;
  description?: string;
  costCenterCode?: string;
  debit?: number; // öre
  credit?: number; // öre
}

interface NormLine {
  account: string;
  accountName: string;
  description: string | null;
  costCenterCode: string | null;
  debit: number; // öre
  credit: number; // öre
}

// Parse + validate the voucher lines: each row needs an account, amounts are
// non-negative, and the verification must balance (debit total == credit total).
function prepareLines(
  body: { lines?: unknown },
): { ok: true; lines: NormLine[] } | { ok: false; error: string; status: number } {
  const rawLines: LineInput[] = Array.isArray(body.lines) ? body.lines : [];
  const lines: NormLine[] = rawLines
    .map((l) => ({
      account: String(l.account ?? "").trim(),
      accountName: String(l.accountName ?? "").trim(),
      description: l.description?.toString().trim() || null,
      costCenterCode: l.costCenterCode?.toString() || null,
      debit: Math.round(Number(l.debit) || 0),
      credit: Math.round(Number(l.credit) || 0),
    }))
    .filter((l) => l.account || l.debit || l.credit);

  // The rule itself is in lib/domain/voucher.ts, so the booking screen can
  // apply it before offering the button and get the same answer.
  const blocker = voucherBlocker(lines);
  if (blocker) return { ok: false, error: `voucher.${blocker}`, status: 422 };
  return { ok: true, lines };
}

// The payment row is not the bookkeeper's to choose: a card purchase already
// left the section's bank, a private outlay is a debt to the member. The UI
// renders that row as fixed, and this is the same rule on the server — the
// client is a convenience, not the gate.
async function checkPaymentLine(
  lines: NormLine[],
  expense: { paymentType: "CARD" | "REIMBURSEMENT"; grossAmount: number | null },
): Promise<{ code: string; account: string } | null> {
  const settings = await prisma.bookkeepingSettings.findUnique({ where: { id: "singleton" } });
  const account =
    expense.paymentType === "CARD"
      ? (settings?.bankAccount ?? "1930")
      : (settings?.memberDebtAccount ?? "2890");

  const onAccount = lines.filter((l) => l.account === account);
  if (onAccount.length !== 1) {
    return { code: "voucher.onePaymentLine", account };
  }
  const [payment] = onAccount;
  if (payment.costCenterCode) {
    return { code: "voucher.paymentLineNoCostCenter", account };
  }
  if (payment.debit !== 0 || payment.credit !== (expense.grossAmount ?? 0)) {
    return { code: "voucher.paymentLineFullAmount", account };
  }
  return null;
}

// Resolve the cost-center codes used by the lines to their ids.
async function costCenterIdByCode(lines: NormLine[]): Promise<Map<string, string>> {
  const codes = [...new Set(lines.map((l) => l.costCenterCode).filter(Boolean))] as string[];
  const ccs = await prisma.costCenter.findMany({ where: { code: { in: codes } } });
  return new Map(ccs.map((c) => [c.code, c.id]));
}

// The rows as Prisma nested-create data. Identical for creating and replacing,
// which is the whole reason it is a function.
const voucherLineData = (lines: NormLine[], idByCode: Map<string, string>) =>
  lines.map((l, i) => ({
    account: l.account,
    accountName: l.accountName,
    description: l.description,
    costCenterId: l.costCenterCode ? idByCode.get(l.costCenterCode) ?? null : null,
    debit: l.debit,
    credit: l.credit,
    sortOrder: i,
  }));

// Authority + the expense. Booking creates a verification in the section's
// books, so it is bookkeepers only — the status checks below say *which*
// utlägg, never *who*.
async function loadForBooking(id: string) {
  const g = await gate(canBookkeep, "auth.bookkeeperBook");
  if (!g.ok) return { ok: false as const, res: g.res };

  const expense = await prisma.expense.findUnique({
    where: { id },
    include: { verification: true },
  });
  if (!expense) return { ok: false as const, res: fail(404, "expense.notFound") };
  return { ok: true as const, actor: g.actor, expense };
}

// The rows, validated against the utlägg they belong to.
async function prepareVoucher(
  body: { lines?: unknown },
  expense: { paymentType: "CARD" | "REIMBURSEMENT"; grossAmount: number | null },
) {
  const prepared = prepareLines(body);
  if (!prepared.ok) return { ok: false as const, res: fail(prepared.status, prepared.error) };

  const paymentError = await checkPaymentLine(prepared.lines, expense);
  if (paymentError) {
    return {
      ok: false as const,
      res: fail(422, paymentError.code, { values: { account: paymentError.account } }),
    };
  }

  return {
    ok: true as const,
    lines: prepared.lines,
    idByCode: await costCenterIdByCode(prepared.lines),
  };
}

// The verification's date and heading — the caller may set both, and each falls
// back to what the utlägg already says.
function voucherMeta(
  body: { date?: unknown; description?: unknown },
  fallback: { date: Date; description: string },
) {
  return {
    date: body.date ? new Date(body.date as string) : fallback.date,
    description:
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : fallback.description,
  };
}

// POST — create the voucher for an APPROVED expense and flip it to BOOKED.
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

  const body = await req.json().catch(() => ({}));
  const voucher = await prepareVoucher(body, expense);
  if (!voucher.ok) return voucher.res;

  const { date, description } = voucherMeta(body, {
    date: new Date(),
    description: expense.title,
  });

  await prisma.$transaction(async (tx) => {
    await tx.verification.create({
      data: {
        expenseId: expense.id,
        date,
        description,
        createdById: actor.id,
        lines: { create: voucherLineData(voucher.lines, voucher.idByCode) },
      },
    });
    await tx.expense.update({ where: { id: expense.id }, data: { status: "BOOKED" } });
    await tx.expenseEvent.create({
      data: { expenseId: expense.id, type: "BOOKED", actorId: actor.id },
    });
  });

  return NextResponse.json({ ok: true, id }, { status: 201 });
}

// PATCH — amend the konteringsrader of a BOOKED (not yet EXPORTED) verification.
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
  const verification = expense.verification;
  if (!verification) return fail(404, "expense.noVoucherToAmend");

  const body = await req.json().catch(() => ({}));
  const voucher = await prepareVoucher(body, expense);
  if (!voucher.ok) return voucher.res;

  const { date, description } = voucherMeta(body, verification);

  await prisma.$transaction(async (tx) => {
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
  });

  return NextResponse.json({ ok: true, id }, { status: 200 });
}
