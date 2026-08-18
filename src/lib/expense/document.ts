// The utläggsräkning: turning an utlägg into the cover page that fronts its
// underlag, and deciding when that page is drawn and when it is kept.
//
// Shaped after lib/income/document.ts, which does the same job for a day's
// takings, and for the same reasons — down to the render/store split. What is
// stored is the cover *alone*, and it stays alone everywhere but the export,
// where the receipt is stapled behind it on the way to Fortnox. See
// lib/server/pdf-merge.ts for why.
//
// The engine is behind cover/typst.ts and reached only through `renderCover`,
// so nothing in this file knows what typesets anything.
import "server-only";

import { prisma } from "@/lib/server/db";
import { expenseDocumentKey, putObject } from "@/lib/server/storage";
import { CoverRenderError, renderCover } from "./cover/typst";
import type { ExpenseCoverData } from "./cover/types";

/**
 * Why an utlägg has no cover page. Each maps to a message key under
 * `errors.expense`, so a route can hand it straight to `fail()` — the same
 * contract lib/income/document.ts has with its own route.
 */
export type DocumentFailure =
  | { reason: "expenseNotFound" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderedDocument = { ok: true; bytes: Uint8Array; filename: string };
export type StoredDocument = { ok: true; key: string; filename: string };

export type RenderResult = RenderedDocument | ({ ok: false } & DocumentFailure);
export type StoreResult = StoredDocument | ({ ok: false } & DocumentFailure);

/** öre → "1 069,00 kr", the way the rest of the app writes money in Swedish. */
function kr(ore: number): string {
  return `${new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ore / 100)} kr`;
}

const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** How the two payment types are worded on the page. Fixed Swedish, not a
 *  translation lookup: see the note on ExpenseCoverData. */
const PAYMENT_TYPE: Record<string, string> = {
  REIMBURSEMENT: "Privat utlägg",
  CARD: "Sektionskort",
};

/**
 * Everything the cover page needs, and nothing else.
 *
 * Written out rather than derived from the Prisma client's types, so that
 * `buildCoverData` can be called — and tested — with a plain object. Tying it
 * to a generated payload type would mean constructing one to assert on the
 * wording, which is the opposite of the point.
 */
type ExpenseForCover = {
  reference: string | null;
  title: string;
  purchaseDate: Date | null;
  paymentType: string;
  grossAmount: number | null;
  submitter: { name: string; studentId: string | null };
  allocations: {
    amount: number;
    comment: string | null;
    approvedAt: Date | null;
    costCenter: { code: string; name: string };
    approvedBy: { name: string } | null;
  }[];
};

/**
 * An utlägg as the cover page states it.
 *
 * Pure, and exported for that reason: every decision the document makes about
 * wording is made here, and can be asserted on without a typesetter installed
 * anywhere. The engine only places what this returns.
 *
 * The total is the sum of the allocations rather than `grossAmount`. They are
 * the same number by the rule that every allocation must sum to it, but this
 * page is a statement about what was *attested*, and the attestations are per
 * allocation — so the figure at the bottom is the one the rows above it add up
 * to, whatever else the utlägg records.
 */
export function buildCoverData(expense: ExpenseForCover, today: Date): ExpenseCoverData {
  return {
    // A booked utlägg always has a reference (it is assigned at submission), so
    // the fallback is for a draft being previewed before it has one.
    reference: expense.reference ?? "—",
    title: expense.title,
    purchaseDate: isoDate(expense.purchaseDate),
    paymentType: PAYMENT_TYPE[expense.paymentType] ?? expense.paymentType,
    created: isoDate(today)!,
    submitter: {
      name: expense.submitter.name,
      studentId: expense.submitter.studentId,
    },
    total: kr(expense.allocations.reduce((sum, a) => sum + a.amount, 0)),
    allocations: expense.allocations.map((a) => ({
      costCenter: `${a.costCenter.code} · ${a.costCenter.name}`,
      amount: kr(a.amount),
      comment: a.comment,
      // Null rather than a placeholder: what an unattested slice reads as is
      // the page's decision, not this function's, and the template says it in
      // one place for every field that can be missing.
      approvedBy: a.approvedBy?.name ?? null,
      approvedAt: isoDate(a.approvedAt),
    })),
  };
}

/** `utlaggsrakning-DEK26-0042.pdf`, or the id where there is no reference. */
export function coverFilename(reference: string | null, expenseId: string): string {
  return `utlaggsrakning-${reference ?? expenseId}.pdf`;
}

/**
 * Draw the cover page for an utlägg, keeping nothing.
 *
 * What the document route answers with while the utlägg is still moving. Once
 * it is booked the stored bytes are served instead — see `storeExpenseDocument`
 * and the route.
 */
export async function renderExpenseDocument(expenseId: string): Promise<RenderResult> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: {
      reference: true,
      title: true,
      purchaseDate: true,
      paymentType: true,
      grossAmount: true,
      submitter: { select: { name: true, studentId: true } },
      allocations: {
        // By cost-centre code, so two renders of the same utlägg put the rows
        // in the same order — a document that substantiates a voucher should
        // not depend on the order the database happened to return.
        orderBy: [{ costCenter: { code: "asc" } }, { id: "asc" }],
        select: {
          amount: true,
          comment: true,
          approvedAt: true,
          costCenter: { select: { code: true, name: true } },
          approvedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!expense) return { ok: false, reason: "expenseNotFound" };

  try {
    const bytes = await renderCover(buildCoverData(expense, new Date()));
    return { ok: true, bytes, filename: coverFilename(expense.reference, expenseId) };
  } catch (e) {
    const detail = e instanceof CoverRenderError ? e.message : String(e);
    console.error(`[expense] ${expenseId}: the cover page could not be rendered`, e);
    return { ok: false, reason: "renderFailed", detail };
  }
}

/**
 * Draw the cover page and keep it, at booking.
 *
 * Idempotent, and that is the point rather than an optimisation: the cover
 * names who attested each slice and when, so re-rendering it later would
 * produce a *different* document from the one already exported to Fortnox. An
 * utlägg that has one keeps it, and only a reopen clears it — see the schema.
 */
export async function storeExpenseDocument(expenseId: string): Promise<StoreResult> {
  const existing = await prisma.expense.findUnique({
    where: { id: expenseId },
    select: { documentKey: true, documentFilename: true },
  });
  if (!existing) return { ok: false, reason: "expenseNotFound" };
  if (existing.documentKey && existing.documentFilename) {
    return { ok: true, key: existing.documentKey, filename: existing.documentFilename };
  }

  const rendered = await renderExpenseDocument(expenseId);
  if (!rendered.ok) return rendered;

  const key = expenseDocumentKey(expenseId, rendered.filename);
  try {
    await putObject(key, Buffer.from(rendered.bytes), "application/pdf");
  } catch (e) {
    console.error(`[expense] ${expenseId}: the cover page could not be stored`, e);
    return { ok: false, reason: "storeFailed" };
  }

  await prisma.expense.update({
    where: { id: expenseId },
    data: { documentKey: key, documentFilename: rendered.filename },
  });

  return { ok: true, key, filename: rendered.filename };
}
