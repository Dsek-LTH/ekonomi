// The seeded utlägg, written as the app would have left them.
//
// The fixtures in seed-data.ts say what people did: who attested which row,
// who konterade it and on which account, who bokförde it. Everything the app
// writes down along the way is derived from that here, by the same rules the
// app follows: the history, the reference, the matched card purchase, the
// receipt, the voucher, and for a bokfört utlägg its place in the ledger.
//
// And it is checked before anything is written. Each utlägg is run through the
// app's own rules (submitBlocker, the attest rule, voucherBlocker, the
// two-person rule on bokföring) and the seed stops, naming every problem, if
// any of them would not have allowed it. A fixture the app could never have
// produced is how a screen ends up guarding against a state that cannot
// happen, so the seed is not allowed to write one.
import { randomUUID } from "node:crypto";
import type { ExpenseEventType, PrismaClient, Role } from "../src/lib/generated/prisma/client";
import { REIMBURSEMENT_DEADLINE_DAYS, isOutOfPocket, submitBlocker } from "../src/lib/domain/status";
import { isRevenueAccount, voucherBlocker } from "../src/lib/domain/voucher";
import { reviewBlocker, voucherTextPrefix } from "../src/lib/domain/review";
import {
  canAttestAllocation,
  canBookkeep,
  canLogInToFortnox,
  canReviewOwnBooking,
} from "../src/lib/domain/permissions";
import { cancelsOut, isMatchable } from "../src/lib/domain/matching";
import { claimBlocker, valueJourney } from "../src/lib/mileage/claim";
import type { MileageRateLike } from "../src/lib/mileage/rate";
import { formatReference } from "../src/lib/domain/reference";
import { voucherText } from "../src/lib/fortnox/voucher-text";
import { normaliseImage, normalisedName } from "../src/lib/server/images";
import { receiptKey } from "../src/lib/storage-keys";
import type { Capability } from "../src/lib/domain/types";
import { putObject } from "../scripts/storage-admin";
import { renderReceipt } from "./seed-receipts";
import { BANK_TRANSACTIONS, EXPENSES, type SeedExpense, type SeedStatus } from "./seed-data";

const ore = (sek: number) => Math.round(sek * 100);

const STAGE: Record<SeedStatus, number> = {
  DRAFT: 0,
  CHANGES_REQUESTED: 1,
  PENDING_APPROVAL: 1,
  APPROVED: 2,
  BOOKED: 3,
  EXPORTED: 4,
};
const atLeast = (status: SeedStatus, stage: SeedStatus) => STAGE[status] >= STAGE[stage];

/** YYYY-MM-DD, so many days before `from`. String arithmetic in UTC, so no
 *  timezone can move the day. */
export function dayBefore(from: string, days: number): string {
  const d = new Date(`${from}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const earlier = (a: Date, b: Date) => (a < b ? a : b);

/** A moment on a day, in local time: `day` plus `days`, at `hhmm`. */
function at(day: string, days: number, hhmm: string): Date {
  const d = new Date(`${day}T${hhmm}:00`);
  d.setDate(d.getDate() + days);
  return d;
}

export interface SeedContext {
  prisma: PrismaClient;
  today: string;
  now: Date;
  userId: (name: string) => string;
  rolesOf: (name: string) => Role[];
  capabilitiesOf: (name: string) => Capability[];
  studentIdOf: (name: string) => string;
  /** Result units the person answers for. */
  ownedUnitsOf: (name: string) => string[];
  hasPayout: (name: string) => boolean;
  costCenter: (code: string) => { id: string; name: string; resultUnit: string | null } | undefined;
  /** The section card a person holds, if any. */
  cardOf: (name: string) => { id: string; last4: string } | undefined;
  cardByLast4: (last4: string) => string | undefined;
  settings: { bankAccount: string; memberDebtAccount: string };
  accountName: (n: string) => string | undefined;
  projectExists: (n: string) => boolean;
  rates: MileageRateLike[];
  /** The ledger's financial year for a day, and the next voucher number in series A. */
  financialYearFor: (day: string) => Promise<number>;
  nextVoucherNumber: () => number;
}

/** One utlägg with everything derived: amounts, dates, the voucher. */
interface Planned {
  spec: SeedExpense;
  purchaseDate: string;
  /** SEK, signed. */
  gross: number;
  allocations: { code: string; amount: number }[];
  km: number | null;
  orePerKm: number | null;
  created: Date;
  submitted: Date | null;
  changesRequestedAt: Date | null;
  /** Sent back and sent again, for one with `returnedOnce`. */
  returned: { at: Date; resubmitted: Date } | null;
  /** When a card purchase's bank row was imported. Never after the seed runs. */
  imported: Date | null;
  /** When each attester signed, in the order they did. */
  attests: { by: string; at: Date }[];
  booked: Date | null;
  exported: Date | null;
  lines: { account: string; costCenterCode: string | null; project: string | null; debit: number; credit: number }[];
  description: string;
  reference: string | null;
}

function plan(spec: SeedExpense, ctx: SeedContext): Planned {
  const purchaseDate = dayBefore(ctx.today, spec.daysAgo);
  const valued = spec.journey
    ? valueJourney(
        { date: purchaseDate, odometerStart: spec.journey.odometerStart, odometerEnd: spec.journey.odometerEnd },
        ctx.rates,
      )
    : null;
  // A milersättning is worth its journey. Anything else is what its rows say.
  const gross =
    spec.paymentType === "MILEAGE"
      ? (valued?.ore ?? 0) / 100
      : spec.allocations.reduce((s, a) => s + (a.amount ?? 0), 0);
  const allocations = spec.allocations.map((a) => ({
    code: a.costCenterCode,
    amount: spec.paymentType === "MILEAGE" && spec.allocations.length === 1 ? gross : (a.amount ?? 0),
  }));

  // The day's events, each on a later day than the one before, at an hour
  // somebody would plausibly have done it.
  const created = at(purchaseDate, 0, spec.receipt ? laterThan(spec.receipt.time) : "18:30");
  // Sent `submittedAfterDays` after the purchase, and every later step moves
  // with it. A return and a resend take a day each.
  let day = spec.submittedAfterDays ?? 1;
  const submitted = atLeast(spec.status, "PENDING_APPROVAL") || spec.status === "CHANGES_REQUESTED"
    ? at(purchaseDate, day, "09:15")
    : null;
  const changesRequestedAt = spec.status === "CHANGES_REQUESTED" ? at(purchaseDate, day + 1, "14:40") : null;
  const returned = spec.returnedOnce
    ? { at: at(purchaseDate, day + 1, "14:40"), resubmitted: at(purchaseDate, day + 2, "09:15") }
    : null;
  if (returned) day += 2;
  const attesters = [...new Set(spec.allocations.flatMap((a) => (a.attestedBy ? [a.attestedBy] : [])))];
  const attests = attesters.map((by, i) => ({ by, at: at(purchaseDate, day + 1 + i, "08:30") }));
  const lastDay = day + attests.length;
  const importedAt = at(purchaseDate, spec.bankImportedAfterDays ?? 1, "08:00");
  const imported = spec.paymentType === "CARD" ? (importedAt > ctx.now ? ctx.now : importedAt) : null;
  const booked = atLeast(spec.status, "BOOKED") ? at(purchaseDate, lastDay + 1, "13:45") : null;
  const exported = spec.status === "EXPORTED" ? at(purchaseDate, lastDay + 2, "10:20") : null;

  // The kontering, as the kontering screen builds it: the locked payment row,
  // then a row per cost centre. A return is the same voucher the other way
  // round, so no amount on it is ever negative.
  const payment = spec.paymentType === "CARD" ? ctx.settings.bankAccount : ctx.settings.memberDebtAccount;
  const side = (sek: number, debitWhenPositive: boolean) => {
    const amount = ore(Math.abs(sek));
    const debit = (sek >= 0) === debitWhenPositive;
    return { debit: debit ? amount : 0, credit: debit ? 0 : amount };
  };
  const lines = atLeast(spec.status, "BOOKED")
    ? [
        { account: payment, costCenterCode: null, project: null, ...side(gross, false) },
        ...spec.allocations.map((a, i) => ({
          account: a.account ?? "",
          costCenterCode: a.costCenterCode,
          project: a.project ?? null,
          ...side(allocations[i].amount, true),
        })),
      ]
    : [];
  const prefix = voucherTextPrefix(spec.paymentType, ctx.studentIdOf(spec.submitterName));

  return {
    spec,
    purchaseDate,
    gross,
    allocations,
    km: valued?.km ?? null,
    orePerKm: valued?.orePerKm ?? null,
    created,
    submitted,
    changesRequestedAt,
    returned,
    imported,
    attests,
    booked,
    exported,
    lines,
    description: `${prefix} ${spec.title}`,
    reference: null,
  };
}

// An hour after the time on the slip: the utlägg is written once they are home.
function laterThan(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(Math.min(h + 1, 23)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Every way this utlägg differs from one the app could have produced. */
function problems(p: Planned, ctx: SeedContext): string[] {
  const { spec } = p;
  const out: string[] = [];
  const say = (msg: string) => out.push(`"${spec.title}": ${msg}`);
  const submitter = spec.submitterName;

  // The receipt, or the journey that stands in for one.
  if (spec.paymentType === "MILEAGE") {
    if (!spec.journey) say("a milersättning needs a journey");
    if (spec.receipt) say("a milersättning has no receipt");
  } else {
    if (!spec.receipt) say("every utlägg but a milersättning has a receipt");
    else {
      const slip = spec.receipt.lines.reduce((s, l) => s + l.amount, 0);
      if (ore(slip) !== ore(p.gross)) say(`the receipt says ${slip} kr and the rows ${p.gross} kr`);
    }
  }
  if (p.allocations.some((a) => !ctx.costCenter(a.code))) say("names a cost centre the budget does not have");

  // A card purchase settles a row on the submitter's own card.
  if (isMatchable(spec.paymentType) && !ctx.cardOf(submitter)) {
    say(`${submitter} holds no section card to have paid with`);
  }

  // Everything past the draft was sent in, and the app only lets through what
  // submitBlocker passes.
  if (spec.status !== "DRAFT") {
    const blocker = submitBlocker({
      title: spec.title,
      purchaseDate: p.purchaseDate,
      grossAmount: p.gross,
      paymentType: spec.paymentType,
      matchedTransactionId: spec.paymentType === "CARD" ? "seeded" : undefined,
      submitterHasPayout: ctx.hasPayout(submitter),
      hasReceipt: Boolean(spec.receipt),
      mileageBlocker: spec.journey
        ? claimBlocker({ ...spec.journey, date: p.purchaseDate }, ctx.rates)
        : null,
      // The filing deadline is checked below, on the day it was sent:
      // submitBlocker counts from today, which for an utlägg sent long ago
      // asks the wrong question.
      deadlineWaived: true,
      allocations: p.allocations.map((a) => ({ costCenterCode: a.code, amount: a.amount })),
    });
    if (blocker) say(`could not have been submitted (${blocker})`);
    const waited = spec.submittedAfterDays ?? 1;
    if (isOutOfPocket(spec.paymentType) && waited > REIMBURSEMENT_DEADLINE_DAYS) {
      say(`sent ${waited} days after the purchase, past the filing deadline, without a dispens`);
    }
    // The match needs the bank row, so a card purchase waits for the import.
    if (p.imported && p.submitted && p.submitted < p.imported) {
      say("a card purchase sent before its bank row was imported");
    }
  }
  if (spec.returnedOnce) {
    if (!atLeast(spec.status, "PENDING_APPROVAL")) say("only an utlägg sent again was returned once");
    const by = spec.returnedOnce.by;
    const may = spec.allocations.some((a) =>
      canAttestAllocation({
        actorCapabilities: ctx.capabilitiesOf(by),
        actorRoles: ctx.rolesOf(by),
        actorIsSubmitter: by === submitter,
        actorOwnedResultUnits: ctx.ownedUnitsOf(by),
        allocationResultUnit: ctx.costCenter(a.costCenterCode)?.resultUnit ?? null,
      }),
    );
    if (!may) say(`${by} attests none of it, so could not have returned it`);
  }

  // Attest: every row from APPROVED on, some but not all while pending, none
  // before it was sent or once it was sent back. Each by somebody who may.
  const attested = spec.allocations.filter((a) => a.attestedBy).length;
  if (atLeast(spec.status, "APPROVED") && attested !== spec.allocations.length) {
    say("an attested utlägg has every row attested");
  }
  if (spec.status === "PENDING_APPROVAL" && attested === spec.allocations.length) {
    say("a fully attested utlägg is not pending");
  }
  if ((spec.status === "DRAFT" || spec.status === "CHANGES_REQUESTED") && attested > 0) {
    say("nothing is attested before it is sent, or after it is sent back");
  }
  for (const a of spec.allocations) {
    if (!a.attestedBy) continue;
    const ok = canAttestAllocation({
      actorCapabilities: ctx.capabilitiesOf(a.attestedBy),
      actorRoles: ctx.rolesOf(a.attestedBy),
      actorIsSubmitter: a.attestedBy === submitter,
      actorOwnedResultUnits: ctx.ownedUnitsOf(a.attestedBy),
      allocationResultUnit: ctx.costCenter(a.costCenterCode)?.resultUnit ?? null,
    });
    if (!ok) say(`${a.attestedBy} may not attest ${a.costCenterCode}`);
  }
  if (spec.changesRequested) {
    if (spec.status !== "CHANGES_REQUESTED") say("only a sent-back utlägg says who sent it back");
    const by = spec.changesRequested.by;
    const may = spec.allocations.some((a) =>
      canAttestAllocation({
        actorCapabilities: ctx.capabilitiesOf(by),
        actorRoles: ctx.rolesOf(by),
        actorIsSubmitter: by === submitter,
        actorOwnedResultUnits: ctx.ownedUnitsOf(by),
        allocationResultUnit: ctx.costCenter(a.costCenterCode)?.resultUnit ?? null,
      }),
    );
    if (!may) say(`${by} attests none of it, so could not have sent it back`);
  } else if (spec.status === "CHANGES_REQUESTED") {
    say("a sent-back utlägg says who sent it back");
  }

  // The kontering: by a bookkeeper, on accounts in the chart, never on an
  // intäktskonto, and a voucher the kontering screen would have let through.
  if (atLeast(spec.status, "BOOKED")) {
    if (!spec.bookedBy || !canBookkeep(ctx.capabilitiesOf(spec.bookedBy))) {
      say("konterat by somebody who may kontera");
    }
    for (const l of p.lines) {
      if (!ctx.accountName(l.account)) say(`account ${l.account || "(none)"} is not in the chart`);
      if (isRevenueAccount(l.account)) say(`konterat against intäktskonto ${l.account}`);
      if (l.project && !ctx.projectExists(l.project)) say(`project ${l.project} does not exist`);
    }
    const blocker = voucherBlocker(p.lines);
    if (blocker) say(`the kontering would be refused (${blocker})`);
  } else if (spec.bookedBy || spec.allocations.some((a) => a.account || a.project)) {
    say("only a konterat utlägg has a kontering");
  }

  // Bokföring: by somebody with a Fortnox login, and not by whoever konterade
  // it unless their role is exempt.
  if (spec.status === "EXPORTED") {
    const by = spec.exportedBy;
    if (!by || !canLogInToFortnox(ctx.capabilitiesOf(by))) say("bokfört by somebody who may bokföra");
    else if (
      reviewBlocker({
        exempt: canReviewOwnBooking(ctx.capabilitiesOf(by)),
        viewerId: by,
        bookedBy: spec.bookedBy ? [spec.bookedBy] : [],
      })
    ) {
      say(`${by} konterade it and may not bokföra it too`);
    }
  } else if (spec.exportedBy) {
    say("only a bokfört utlägg says who bokförde it");
  }

  // And nothing is dated after the seed runs.
  const moments = [
    p.created,
    p.submitted,
    p.changesRequestedAt,
    p.returned?.at,
    p.returned?.resubmitted,
    p.booked,
    p.exported,
    ...p.attests.map((a) => a.at),
  ];
  if (moments.some((m) => m && m > ctx.now)) say("has a step dated in the future; raise its daysAgo");
  return out;
}

/** Seed the utlägg, after checking every one of them. Returns how many receipts went up. */
export async function seedExpenses(ctx: SeedContext): Promise<{ receipts: number }> {
  const planned = EXPENSES.map((spec) => plan(spec, ctx));
  const errors = planned.flatMap((p) => problems(p, ctx));
  for (const t of BANK_TRANSACTIONS) {
    if (t.cardLast4 && !ctx.cardByLast4(t.cardLast4)) errors.push(`bank row "${t.description}": no card ${t.cardLast4}`);
  }
  if (errors.length > 0) {
    throw new Error(`The seed's utlägg break the app's rules:\n  - ${errors.join("\n  - ")}`);
  }

  // References in the order they were sent in, numbered per year, the way
  // claimReference hands them out.
  const counters = new Map<number, number>();
  for (const p of [...planned].filter((p) => p.submitted).sort((a, b) => +a.submitted! - +b.submitted!)) {
    const year = p.submitted!.getFullYear();
    const n = (counters.get(year) ?? 0) + 1;
    counters.set(year, n);
    p.reference = formatReference(year, n);
  }

  const { prisma } = ctx;

  // The bank rows nothing has claimed.
  for (const t of BANK_TRANSACTIONS) {
    const cardId = t.cardLast4 ? ctx.cardByLast4(t.cardLast4) : undefined;
    await prisma.bankTransaction.create({
      data: {
        transactionDate: new Date(dayBefore(ctx.today, t.daysAgo)),
        description: t.description,
        amount: ore(t.amount),
        cardId: cardId ?? null,
        cardLast4: t.cardLast4,
        importedAt: earlier(at(dayBefore(ctx.today, t.daysAgo), t.importedAfterDays ?? 1, "08:00"), ctx.now),
      },
    });
  }

  let receipts = 0;
  for (const p of planned) {
    const { spec } = p;
    const submitterId = ctx.userId(spec.submitterName);
    const card = spec.paymentType === "CARD" ? ctx.cardOf(spec.submitterName) : undefined;

    // A card purchase is settled by the row it made on the card: the same
    // day, the opposite amount.
    const matched = card
      ? await prisma.bankTransaction.create({
          data: {
            transactionDate: new Date(p.purchaseDate),
            description: spec.receipt!.merchant.toUpperCase(),
            amount: -ore(p.gross),
            cardId: card.id,
            cardLast4: card.last4,
            importedAt: p.imported!,
          },
        })
      : null;
    if (matched && !cancelsOut(matched.amount, ore(p.gross))) {
      throw new Error(`"${spec.title}": the matched bank row does not settle it`);
    }

    const events: { type: ExpenseEventType; actorId: string; comment?: string; createdAt: Date }[] = [
      // Matching and the receipt happened while it was a draft, which writes
      // nothing to the history (isQuietDraftEdit). Creating it does.
      { type: "CREATED", actorId: submitterId, createdAt: p.created },
    ];
    if (p.submitted) events.push({ type: "SUBMITTED", actorId: submitterId, createdAt: p.submitted });
    if (p.returned && spec.returnedOnce) {
      events.push(
        {
          type: "CHANGES_REQUESTED",
          actorId: ctx.userId(spec.returnedOnce.by),
          comment: spec.returnedOnce.comment,
          createdAt: p.returned.at,
        },
        { type: "SUBMITTED", actorId: submitterId, createdAt: p.returned.resubmitted },
      );
    }
    if (p.changesRequestedAt && spec.changesRequested) {
      events.push({
        type: "CHANGES_REQUESTED",
        actorId: ctx.userId(spec.changesRequested.by),
        comment: spec.changesRequested.comment,
        createdAt: p.changesRequestedAt,
      });
    }
    for (const a of p.attests) {
      events.push({ type: "COST_CENTER_APPROVED", actorId: ctx.userId(a.by), createdAt: a.at });
    }
    if (p.booked) events.push({ type: "BOOKED", actorId: ctx.userId(spec.bookedBy!), createdAt: p.booked });

    const fy = p.exported ? await ctx.financialYearFor(p.purchaseDate) : null;
    const voucherNumber = p.exported ? ctx.nextVoucherNumber() : null;
    const label = voucherNumber ? `A-${voucherNumber}` : null;
    if (p.exported && label) {
      events.push({ type: "EXPORTED", actorId: ctx.userId(spec.exportedBy!), comment: label, createdAt: p.exported });
    }

    const attestAt = new Map(p.attests.map((a) => [a.by, a.at]));
    const expense = await prisma.expense.create({
      data: {
        reference: p.reference,
        title: spec.title,
        submitterId,
        paymentType: spec.paymentType,
        status: spec.status,
        purchaseDate: new Date(p.purchaseDate),
        grossAmount: ore(p.gross),
        currency: "SEK",
        matchedTransactionId: matched?.id ?? null,
        odometerStart: spec.journey?.odometerStart ?? null,
        odometerEnd: spec.journey?.odometerEnd ?? null,
        journeyStops: spec.journey?.stops ?? [],
        mileageOrePerKm: spec.journey ? p.orePerKm : null,
        createdAt: p.created,
        events: { create: events },
        allocations: {
          create: spec.allocations.map((a, i) => ({
            costCenterId: ctx.costCenter(a.costCenterCode)!.id,
            amount: ore(p.allocations[i].amount),
            approvedById: a.attestedBy ? ctx.userId(a.attestedBy) : null,
            approvedAt: a.attestedBy ? attestAt.get(a.attestedBy)! : null,
          })),
        },
      },
    });

    if (p.booked) {
      await prisma.verification.create({
        data: {
          expenseId: expense.id,
          date: new Date(p.purchaseDate),
          description: p.description,
          createdById: ctx.userId(spec.bookedBy!),
          createdAt: p.booked,
          fortnoxSeries: label ? "A" : null,
          fortnoxNumber: voucherNumber,
          fortnoxYear: fy,
          exportedAt: p.exported,
          lines: {
            create: p.lines.map((l, i) => ({
              account: l.account,
              accountName: ctx.accountName(l.account)!,
              costCenterId: l.costCenterCode ? ctx.costCenter(l.costCenterCode)!.id : null,
              project: l.project,
              debit: l.debit,
              credit: l.credit,
              sortOrder: i,
            })),
          },
        },
      });
    }

    // What Fortnox holds for it, in the ledger mirror, so Utfall counts it.
    if (p.exported && fy != null && voucherNumber != null) {
      await prisma.ledgerVoucher.create({
        data: {
          financialYear: fy,
          series: "A",
          number: voucherNumber,
          date: new Date(p.purchaseDate),
          description: voucherText(p.description, p.reference),
          rows: {
            create: p.lines.map((l) => ({
              financialYear: fy,
              date: new Date(p.purchaseDate),
              account: l.account,
              accountName: ctx.accountName(l.account)!,
              costCenterCode: l.costCenterCode,
              costCenterName: l.costCenterCode ? ctx.costCenter(l.costCenterCode)!.name : null,
              debit: l.debit,
              credit: l.credit,
            })),
          },
        },
      });
    }

    if (spec.receipt) {
      const photo = await renderReceipt({
        merchant: spec.receipt.merchant,
        address: spec.receipt.address,
        date: p.purchaseDate,
        time: spec.receipt.time,
        lines: spec.receipt.lines,
        paidWith: card ? `KORT ****${card.last4}` : (spec.receipt.paidWith ?? "KORT"),
        seed: [...spec.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 100_000, 7),
      });
      // Through the same normalisation an upload gets, under the same key.
      const normalised = await normaliseImage(photo);
      const filename = normalisedName(`kvitto-${spec.receipt.merchant}.jpg`, normalised.mimeType);
      const receiptId = randomUUID();
      const objectKey = receiptKey(expense.id, receiptId, filename);
      await putObject(objectKey, normalised.full, normalised.mimeType);
      await prisma.receipt.create({
        data: {
          id: receiptId,
          expenseId: expense.id,
          objectKey,
          filename,
          mimeType: normalised.mimeType,
          byteSize: normalised.full.length,
          uploadedById: submitterId,
          position: 0,
          createdAt: p.created,
        },
      });
      receipts += 1;
    }
  }

  // An eget utlägg that has been bokfört is paid out: the row leaves the
  // account the day after. Not matched to anything, since only a card
  // purchase is (isMatchable).
  for (const p of planned) {
    if (!p.exported || p.spec.paymentType === "CARD") continue;
    const day = at(p.exported.toISOString().slice(0, 10), 1, "12:00");
    if (day > ctx.now) continue;
    await prisma.bankTransaction.create({
      data: {
        transactionDate: new Date(day.toISOString().slice(0, 10)),
        description: `UTBETALNING ${p.spec.submitterName.toUpperCase()}`,
        amount: -ore(p.gross),
      },
    });
  }

  return { receipts };
}
