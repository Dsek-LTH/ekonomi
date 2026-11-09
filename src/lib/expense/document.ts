// The utläggsräkning: the cover page fronting an utlägg's underlag, and when it is drawn or kept.
// Only the cover is stored. The receipt is stapled behind it at export (lib/server/pdf-merge.ts).
// A milersättning has no receipt, so its journey is a section of this page (`buildJourney`).
import "server-only";

import { prisma } from "@/lib/server/db";
import { expenseDocumentKey, putObject } from "@/lib/server/storage";
import { journeyKm, namedStops } from "@/lib/mileage/claim";
import { daysAgo, isoDay } from "@/lib/domain/date";
import { CoverRenderError, renderCover } from "./cover/typst";
import { bookingNamesOf, type BookingNames } from "@/lib/server/review";
import type {
  ExpenseCoverBooking,
  ExpenseCoverData,
  ExpenseCoverJourney,
  ExpenseCoverWaiver,
} from "./cover/types";
import { formatNumber, formatOreKr } from "@/lib/ui/format";
import { oreToSEK } from "@/lib/domain/money";

/** Why an utlägg has no cover page. Each maps to a message key under `errors.expense`. */
export type DocumentFailure =
  | { reason: "expenseNotFound" }
  | { reason: "renderFailed"; detail: string }
  | { reason: "storeFailed" };

export type RenderedDocument = { ok: true; bytes: Uint8Array; filename: string };
export type StoredDocument = { ok: true; key: string; filename: string };

export type RenderResult = RenderedDocument | ({ ok: false } & DocumentFailure);
export type StoreResult = StoredDocument | ({ ok: false } & DocumentFailure);

/** A reading, always with its tenth ("12 300,0 km"), so readings and their difference share a precision. */
const km = (n: number): string => `${formatNumber(n, 1, 1)} km`;

const DASH = "-";

const isoDate = (d: Date | null | undefined): string | null => (d ? isoDay(d) : null);

/** Fixed Swedish, not a translation lookup (see ExpenseCoverData). */
const PAYMENT_TYPE: Record<string, string> = {
  REIMBURSEMENT: "Privat utlägg",
  CARD: "Sektionskort",
  MILEAGE: "Milersättning",
};

/** Everything the cover page needs. Plain data rather than Prisma types, so `buildCoverData` is testable with a plain object. */
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
  /** Who konterade it, from its history. Absent or null before it is. */
  booking?: BookingNames | null;
};

/** The journey behind a milersättning, or null. A half-filled draft is stated in dashes rather than refused. */
function buildJourney(expense: ExpenseForCover): ExpenseCoverJourney | null {
  if (expense.paymentType !== "MILEAGE") return null;
  const distance = journeyKm(expense.odometerStart, expense.odometerEnd);
  return {
    // Joined here so the wording is asserted without a typesetter. The arrow matches the detail page.
    route: namedStops(expense.journeyStops).join(" → ") || DASH,
    odometerStart: expense.odometerStart == null ? DASH : km(expense.odometerStart),
    odometerEnd: expense.odometerEnd == null ? DASH : km(expense.odometerEnd),
    distance: distance == null ? DASH : km(distance),
    rate:
      expense.mileageOrePerKm == null
        ? DASH
        : `${formatNumber(oreToSEK(expense.mileageOrePerKm), 2, 2)} kr/km`,
  };
}

/** The dispens from the filing deadline, or null. Lateness is counted to the day of the dispens,
 * not to today, so the archived page never changes. "Köpet" or "resan" as the date label. */
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

/** The kontering, worded for the page. Names joined the Swedish way. */
function buildBooking(booking: BookingNames | null | undefined): ExpenseCoverBooking | null {
  if (!booking) return null;
  return {
    by: booking.by,
    at: isoDate(booking.at)!,
    amendedBy:
      booking.amendedBy.length > 0 ? new Intl.ListFormat("sv").format(booking.amendedBy) : null,
  };
}

/** An utlägg as the cover page states it. Pure: every wording decision is made here.
 * The total is the sum of the allocations (what was attested), not `grossAmount`. */
export function buildCoverData(expense: ExpenseForCover, today: Date): ExpenseCoverData {
  return {
    // A booked utlägg always has a reference (it is assigned at submission), so
    // the fallback is for a draft being previewed before it has one.
    reference: expense.reference ?? "-",
    title: expense.title,
    purchaseDate: isoDate(expense.purchaseDate),
    // A milersättning has no receipt, so "Kvittodatum" would name a document that does not exist.
    dateLabel: expense.paymentType === "MILEAGE" ? "Resdag" : "Kvittodatum",
    paymentType: PAYMENT_TYPE[expense.paymentType] ?? expense.paymentType,
    created: isoDate(today)!,
    submitter: {
      name: expense.submitter.name,
      studentId: expense.submitter.studentId,
    },
    total: formatOreKr(
      expense.allocations.reduce((sum, a) => sum + a.amount, 0),
      { decimals: 2 },
    ),
    allocations: expense.allocations.map((a) => ({
      // The code alone: what the cost centre is called in Fortnox and the budget.
      costCenter: a.costCenter.code,
      amount: formatOreKr(a.amount, { decimals: 2 }),
      comment: a.comment,
      // Null rather than a placeholder: the template words every missing field in one place.
      approvedBy: a.approvedBy?.name ?? null,
      approvedAt: isoDate(a.approvedAt),
    })),
    journey: buildJourney(expense),
    waiver: buildWaiver(expense),
    booking: buildBooking(expense.booking),
  };
}

/** `utlaggsrakning-DEK26-0042.pdf`, or the id where there is no reference. */
export function coverFilename(reference: string | null, expenseId: string): string {
  return `utlaggsrakning-${reference ?? expenseId}.pdf`;
}

/** Draw the cover page, keeping nothing. Served while the utlägg is moving; once booked the stored bytes are. */
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
        // By cost-centre code, so two renders put the rows in the same order.
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
  const booking = await bookingNamesOf(expenseId);

  try {
    const bytes = await renderCover(
      buildCoverData(
        {
          ...expense,
          booking,
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

/** Draw the cover and keep it, at booking. Idempotent by necessity: re-rendering would differ
 * from the one already exported to Fortnox. Only a reopen clears it. */
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
