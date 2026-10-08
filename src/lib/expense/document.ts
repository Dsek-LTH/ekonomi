// The utläggsräkning: turning an utlägg into the cover page that fronts its
// underlag, and deciding when that page is drawn and when it is kept.
//
// Shaped after lib/income/document.ts, which does the same job for a day's
// takings, and for the same reasons, down to the render/store split. What is
// stored is the cover *alone*, and it stays alone everywhere but the export,
// where the receipt is stapled behind it on the way to Fortnox. See
// lib/server/pdf-merge.ts for why.
//
// A milersättning is the one utlägg with nothing to staple: there is no receipt
// for driving your own car, so the journey it rests on is a section of this page
// rather than a document of its own. It was a second PDF once, drawn from the
// same row and repeating the same reference, submitter and total under a
// different heading. See `buildJourney`.
//
// The engine is behind cover/typst.ts and reached only through `renderCover`,
// so nothing in this file knows what typesets anything.
import "server-only";

import { prisma } from "@/lib/server/db";
import { expenseDocumentKey, putObject } from "@/lib/server/storage";
import { journeyKm, namedStops } from "@/lib/mileage/claim";
import { daysAgo } from "@/lib/domain/date";
import { CoverRenderError, renderCover } from "./cover/typst";
import type {
  ExpenseCoverData,
  ExpenseCoverJourney,
  ExpenseCoverWaiver,
} from "./cover/types";

/**
 * Why an utlägg has no cover page. Each maps to a message key under
 * `errors.expense`, so a route can hand it straight to `fail()`, the same
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

const nf = (digits: number) =>
  new Intl.NumberFormat("sv-SE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

/** öre → "1 069,00 kr", the way the rest of the app writes money in Swedish. */
function kr(ore: number): string {
  return `${nf(2).format(ore / 100)} kr`;
}

/**
 * A reading, always with its tenth: "12 300,0 km".
 *
 * The distance beside it is a subtraction the reader is invited to do, and two
 * numbers written to different precisions is the one thing that would stop them
 * doing it, so the readings and the difference are all written the same way,
 * even where the tenth is a zero.
 */
const km = (n: number): string => `${nf(1).format(n)} km`;

/** An absent value is said, not left blank. Matches `orDash` in the template. */
const DASH = "–";

const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

/** How each payment type is worded on the page. Fixed Swedish, not a
 *  translation lookup: see the note on ExpenseCoverData. */
const PAYMENT_TYPE: Record<string, string> = {
  REIMBURSEMENT: "Privat utlägg",
  CARD: "Sektionskort",
  MILEAGE: "Milersättning",
};

/**
 * Everything the cover page needs, and nothing else.
 *
 * Written out rather than derived from the Prisma client's types, so that
 * `buildCoverData` can be called, and tested, with a plain object. Tying it
 * to a generated payload type would mean constructing one to assert on the
 * wording, which is the opposite of the point.
 */
type ExpenseForCover = {
  reference: string | null;
  title: string;
  purchaseDate: Date | null;
  paymentType: string;
  grossAmount: number | null;
  /** The total odometer at each end of the journey, for a milersättning. Null
   *  on anything else, and on a half-filled draft. */
  odometerStart: number | null;
  odometerEnd: number | null;
  /** Every place the car stopped, in order. Empty on anything but a
   *  milersättning, and on a draft that has not said yet. */
  journeyStops: string[];
  /** What a kilometre was worth on the day, in öre. Null where the claim was
   *  never valued, a draft saved before a rate covered its date. */
  mileageOrePerKm: number | null;
  submitter: { name: string; studentId: string | null };
  /** The dispens from the filing deadline, where one was given. All three
   *  columns or none; the route writes and clears them together. */
  deadlineWaivedAt: Date | null;
  deadlineWaiverReason: string | null;
  deadlineWaivedBy: { name: string } | null;
  allocations: {
    amount: number;
    comment: string | null;
    approvedAt: Date | null;
    costCenter: { code: string; name: string };
    approvedBy: { name: string } | null;
  }[];
};

/**
 * The journey behind a milersättning, or null where there is not one.
 *
 * This is the whole of what used to be a second document. A mileage claim has
 * no receipt, so the page that fronts the underlag *is* the underlag: the
 * readings go on the cover, under the same reference and the same submitter,
 * and Fortnox is handed one file instead of two saying the same things twice.
 *
 * A half-filled draft is stated in dashes rather than refused. Such a claim
 * cannot be submitted (`claimBlocker` sees to that), but it can be looked at,
 * and "–" is the honest word for a reading nobody has given.
 */
function buildJourney(expense: ExpenseForCover): ExpenseCoverJourney | null {
  if (expense.paymentType !== "MILEAGE") return null;
  const distance = journeyKm(expense.odometerStart, expense.odometerEnd);
  return {
    // Joined here rather than in the template, so the one decision about how a
    // route reads is made in the file where every other wording decision is,
    // and can be asserted on without a typesetter. The arrow is the same one the
    // detail page draws, so the two say the journey the same way.
    route: namedStops(expense.journeyStops).join(" → ") || DASH,
    odometerStart: expense.odometerStart == null ? DASH : km(expense.odometerStart),
    odometerEnd: expense.odometerEnd == null ? DASH : km(expense.odometerEnd),
    distance: distance == null ? DASH : km(distance),
    rate:
      expense.mileageOrePerKm == null
        ? DASH
        : `${nf(2).format(expense.mileageOrePerKm / 100)} kr/km`,
  };
}

/**
 * The dispens from the filing deadline, or null where there was none.
 *
 * How late the claim was is worked out here rather than left to the reader.
 * The page already carries the purchase date and now carries the day the
 * dispens was given, and a reader asked to subtract one from the other across
 * two blocks is a reader who will not. It is counted to the day of the dispens,
 * not to today: what the skattmästare decided about is how late it was when
 * they decided, and a document filed beside a voucher must not say something
 * different next year.
 *
 * "Köpet" or "resan", the same distinction the date label above makes. A
 * milersättning has no purchase.
 */
function buildWaiver(expense: ExpenseForCover): ExpenseCoverWaiver | null {
  const at = isoDate(expense.deadlineWaivedAt);
  if (!at || !expense.deadlineWaiverReason) return null;
  const from = isoDate(expense.purchaseDate);
  const days = from === null ? null : daysAgo(from, at);
  const what = expense.paymentType === "MILEAGE" ? "resan" : "köpet";
  return {
    by: expense.deadlineWaivedBy?.name ?? DASH,
    at,
    reason: expense.deadlineWaiverReason,
    lateness: days === null ? DASH : `${days} dagar efter ${what}`,
  };
}

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
 * allocation, so the figure at the bottom is the one the rows above it add up
 * to, whatever else the utlägg records.
 */
export function buildCoverData(expense: ExpenseForCover, today: Date): ExpenseCoverData {
  return {
    // A booked utlägg always has a reference (it is assigned at submission), so
    // the fallback is for a draft being previewed before it has one.
    reference: expense.reference ?? "–",
    title: expense.title,
    purchaseDate: isoDate(expense.purchaseDate),
    // What that date *is*, which is not the same question for all three types.
    // A milersättning has no receipt, so "Kvittodatum" over the day it was
    // driven would be naming a document that does not exist on a page that is
    // filed as evidence.
    dateLabel: expense.paymentType === "MILEAGE" ? "Resdag" : "Kvittodatum",
    paymentType: PAYMENT_TYPE[expense.paymentType] ?? expense.paymentType,
    created: isoDate(today)!,
    submitter: {
      name: expense.submitter.name,
      studentId: expense.submitter.studentId,
    },
    total: kr(expense.allocations.reduce((sum, a) => sum + a.amount, 0)),
    allocations: expense.allocations.map((a) => ({
      // The code alone, which is what the cost centre is called in Fortnox and
      // in the budget.
      costCenter: a.costCenter.code,
      amount: kr(a.amount),
      comment: a.comment,
      // Null rather than a placeholder: what an unattested slice reads as is
      // the page's decision, not this function's, and the template says it in
      // one place for every field that can be missing.
      approvedBy: a.approvedBy?.name ?? null,
      approvedAt: isoDate(a.approvedAt),
    })),
    journey: buildJourney(expense),
    waiver: buildWaiver(expense),
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
 * it is booked the stored bytes are served instead. See `storeExpenseDocument`
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
      odometerStart: true,
      odometerEnd: true,
      journeyStops: true,
      mileageOrePerKm: true,
      deadlineWaivedAt: true,
      deadlineWaiverReason: true,
      deadlineWaivedBy: { select: { name: true } },
      submitter: { select: { name: true, studentId: true } },
      allocations: {
        // By cost-centre code, so two renders of the same utlägg put the rows
        // in the same order. A document that substantiates a voucher should
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
    const bytes = await renderCover(
      buildCoverData(
        {
          ...expense,
          // Decimal(9,1) columns, and `buildCoverData` is written over plain
          // data so it can be tested with a plain object.
          odometerStart: expense.odometerStart == null ? null : Number(expense.odometerStart),
          odometerEnd: expense.odometerEnd == null ? null : Number(expense.odometerEnd),
        },
        new Date(),
      ),
    );
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
 * utlägg that has one keeps it, and only a reopen clears it. See the schema.
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
