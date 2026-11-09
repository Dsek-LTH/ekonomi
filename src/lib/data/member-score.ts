// Callers check who may ask (canViewMemberScores, or the member's own on /profile); nothing here narrows by viewer.
import "server-only";

import { prisma } from "@/lib/server/db";
import { getPrefixes, resultUnitNameForCode } from "@/lib/server/result-units";
import { stockholmDay, today, isoDay } from "@/lib/domain/date";
import {
  SCORE_WINDOW_DAYS,
  attestsFromEvents,
  memberScore,
  type AttestEvent,
  type MemberScore,
  type ScoreAttest,
  type ScoreCardPurchase,
  type ScoreExpense,
} from "@/lib/domain/member-score";
import { correctionOf, isFaultedCorrection } from "@/lib/domain/correction";

/** Statuses an utlägg is only in once every row is attested. */
const ATTESTED = new Set(["APPROVED", "BOOKED", "EXPORTED"]);

const momentDay = (d: Date) => stockholmDay.format(d); // a timestamp, on the section's calendar
const later = (a: string, b: string) => (a > b ? a : b);

function windowStart(now: string): Date {
  const d = new Date(`${now}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - SCORE_WINDOW_DAYS);
  return d;
}

async function load(submitterIds: string[] | null, now: string) {
  const since = windowStart(now);
  const who = submitterIds ? { in: submitterIds } : undefined;
  const [expenses, purchases] = await Promise.all([
    prisma.expense.findMany({
      where: {
        ...(who && { submitterId: who }),
        OR: [{ purchaseDate: { gte: since } }, { purchaseDate: null, createdAt: { gte: since } }],
      },
      select: {
        id: true,
        title: true,
        submitterId: true,
        paymentType: true,
        status: true,
        purchaseDate: true,
        createdAt: true,
        matchedTransaction: { select: { importedAt: true } },
        events: {
          where: { type: { in: ["SUBMITTED", "CHANGES_REQUESTED", "CORRECTED"] } },
          select: { type: true, createdAt: true, diff: true },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    // The same purchases the nav counts as unaccounted (countUnaccountedPurchases),
    // the money going out only: a refund on the card is nothing to redovisa.
    prisma.bankTransaction.findMany({
      where: {
        card: { holderId: who ?? { not: null } },
        matchedExpense: { is: null },
        amount: { lt: 0 },
        transactionDate: { gte: since },
      },
      select: {
        id: true,
        description: true,
        amount: true,
        transactionDate: true,
        importedAt: true,
        card: { select: { holderId: true } },
      },
    }),
  ]);

  const byMember = new Map<string, Inputs>();
  const of = (id: string) => {
    let m = byMember.get(id);
    if (!m) byMember.set(id, (m = { expenses: [], cardPurchases: [], attests: [] }));
    return m;
  };

  for (const e of expenses) {
    const bought = e.purchaseDate ? isoDay(e.purchaseDate) : momentDay(e.createdAt);
    // A card purchase can only be sent once its bank row is imported, so its clock starts then.
    const startedOn =
      e.paymentType === "CARD"
        ? e.matchedTransaction
          ? later(bought, momentDay(e.matchedTransaction.importedAt))
          : null
        : bought;
    const submitted = e.events.find((ev) => ev.type === "SUBMITTED");
    // A date corrected at kontering counts as sent back (lib/domain/correction.ts).
    const returned = e.events.some(
      (ev) =>
        ev.type === "CHANGES_REQUESTED" ||
        (ev.type === "CORRECTED" && isFaultedCorrection(correctionOf(ev.diff))),
    );
    of(e.submitterId).expenses.push({
      id: e.id,
      title: e.title,
      paymentType: e.paymentType,
      startedOn,
      submittedOn: submitted ? momentDay(submitted.createdAt) : null,
      returned,
      judged: returned || ATTESTED.has(e.status),
    });
  }
  for (const t of purchases) {
    if (!t.card?.holderId) continue;
    of(t.card.holderId).cardPurchases.push({
      id: t.id,
      description: t.description,
      amount: t.amount,
      startedOn: later(isoDay(t.transactionDate), momentDay(t.importedAt)),
    });
  }
  for (const [actorId, a] of await loadAttests(submitterIds, since)) of(actorId).attests.push(...a);
  return byMember;
}

interface Inputs {
  expenses: ScoreExpense[];
  cardPurchases: ScoreCardPurchase[];
  attests: ScoreAttest[];
}

const EXPENSE_ATTEST_EVENTS = [
  "SUBMITTED",
  "COST_CENTER_APPROVED",
  "ATTEST_WITHDRAWN",
  "APPROVED",
  "CHANGES_REQUESTED",
  "RECALLED",
  "BOOKED",
  "CORRECTED",
] as const;
const INVOICE_ATTEST_EVENTS = [
  "ASSIGNED",
  "COST_CENTER_APPROVED",
  "ATTEST_WITHDRAWN",
  "APPROVED",
  "CHANGES_REQUESTED",
  "BOOKED",
  "EXPORTED",
] as const;

const INVOICE_WAITING = ["ASSIGNED", "CHANGES_REQUESTED", "PENDING_APPROVAL"] as const;

const asEvent = (e: { type: string; actorId: string | null; createdAt: Date; diff?: unknown }) =>
  ({
    type: e.type,
    actorId: e.actorId,
    on: momentDay(e.createdAt),
    all: (e.diff as { all?: boolean } | null)?.all === true,
    faulted: e.type === "CORRECTED" && isFaultedCorrection(correctionOf(e.diff)),
  }) satisfies AttestEvent;

/**
 * Every attest given in the window, and every one waiting now, on utlägg and leverantörsfakturor.
 * Waiting is read as the Att attestera queue does; a row no unit owns is left out (a setup gap, not a slow attest).
 */
async function loadAttests(memberIds: string[] | null, since: Date) {
  const signedBy = memberIds ? { actorId: { in: memberIds } } : {};
  const signed = {
    events: {
      some: { type: "COST_CENTER_APPROVED" as const, createdAt: { gte: since }, ...signedBy },
    },
  };
  const eventFields = {
    select: { type: true, actorId: true, createdAt: true, diff: true },
    orderBy: { createdAt: "asc" as const },
  };
  const allocationSelect = {
    select: { approvedById: true, costCenter: { select: { code: true } } },
  };
  const [expenses, invoices, owners, prefixes] = await Promise.all([
    prisma.expense.findMany({
      where: { OR: [signed, { status: "PENDING_APPROVAL" }] },
      select: {
        id: true,
        title: true,
        submitterId: true,
        status: true,
        events: { where: { type: { in: [...EXPENSE_ATTEST_EVENTS] } }, ...eventFields },
        allocations: allocationSelect,
      },
    }),
    prisma.supplierInvoice.findMany({
      where: { OR: [signed, { status: { in: [...INVOICE_WAITING] } }] },
      select: {
        id: true,
        reference: true,
        supplierName: true,
        status: true,
        resultUnit: { select: { name: true } },
        events: { where: { type: { in: [...INVOICE_ATTEST_EVENTS] } }, ...eventFields },
        allocations: allocationSelect,
      },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        roles: { has: "RESULTATANSVARIG" },
        ...(memberIds && { id: { in: memberIds } }),
      },
      select: { id: true, resultUnits: true },
    }),
    getPrefixes(),
  ]);

  const wanted = memberIds ? new Set(memberIds) : null;
  const byActor = new Map<string, ScoreAttest[]>();
  const add = (actorId: string, a: ScoreAttest) => {
    if (wanted && !wanted.has(actorId)) return;
    const list = byActor.get(actorId);
    if (list) list.push(a);
    else byActor.set(actorId, [a]);
  };
  const ownersOf = (unit: string | null) =>
    unit ? owners.filter((o) => o.resultUnits.includes(unit)).map((o) => o.id) : [];
  const unsignedUnits = (rows: { approvedById: string | null; costCenter: { code: string } }[]) =>
    rows
      .filter((r) => !r.approvedById)
      .map((r) => resultUnitNameForCode(r.costCenter.code, prefixes));

  const take = (
    record: ScoreAttest["record"],
    r: { id: string; events: Parameters<typeof asEvent>[0][] },
    title: string,
    waitingOn: string[],
    readyOn: string | null,
  ) => {
    const events = r.events.map(asEvent);
    for (const a of attestsFromEvents(record, events)) {
      add(a.actorId, { record, id: r.id, title, ...a });
    }
    if (!readyOn) return;
    for (const id of new Set(waitingOn)) {
      add(id, { record, id: r.id, title, readyOn, signedOn: null, outcome: "open" });
    }
  };
  const lastOf = (events: { type: string; createdAt: Date }[], types: string[]) => {
    const e = events.findLast((ev) => types.includes(ev.type));
    return e ? momentDay(e.createdAt) : null;
  };

  for (const e of expenses) {
    const signers = new Set(e.allocations.map((a) => a.approvedById).filter(Boolean));
    const waitingOn =
      e.status === "PENDING_APPROVAL"
        ? unsignedUnits(e.allocations)
            .flatMap(ownersOf)
            .filter((id) => id !== e.submitterId && !signers.has(id))
        : [];
    take("expense", e, e.title, waitingOn, lastOf(e.events, ["SUBMITTED"]));
  }
  for (const i of invoices) {
    const signers = new Set(i.allocations.map((a) => a.approvedById).filter(Boolean));
    // Before its split is signed the faktura is the unit's to fördela; after, the rest waits on the remaining rows' units.
    const waitingOn =
      i.status === "PENDING_APPROVAL"
        ? unsignedUnits(i.allocations).flatMap(ownersOf)
        : (INVOICE_WAITING as readonly string[]).includes(i.status)
          ? ownersOf(i.resultUnit?.name ?? null)
          : [];
    const readyOn = lastOf(i.events, [
      "ASSIGNED",
      "CHANGES_REQUESTED",
      "ATTEST_WITHDRAWN",
      "COST_CENTER_APPROVED",
    ]);
    take(
      "invoice",
      i,
      i.supplierName ?? i.reference ?? "",
      waitingOn.filter((id) => !signers.has(id)),
      readyOn,
    );
  }
  return byActor;
}

export async function getMemberScore(userId: string): Promise<MemberScore> {
  const now = today();
  const inputs = (await load([userId], now)).get(userId);
  return memberScore({
    today: now,
    expenses: inputs?.expenses ?? [],
    cardPurchases: inputs?.cardPurchases ?? [],
    attests: inputs?.attests ?? [],
  });
}

export async function getMemberScoreRow(userId: string): Promise<MemberScoreRow | null> {
  const [user, score] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    }),
    getMemberScore(userId),
  ]);
  return user && { userId: user.id, name: user.name, email: user.email, score };
}

export interface MemberScoreRow {
  userId: string;
  name: string;
  email: string;
  score: MemberScore;
}

/** Everybody with anything in the window to score: buyers, attesters and those with something waiting. */
export async function getMemberScores(): Promise<MemberScoreRow[]> {
  const now = today();
  const byMember = await load(null, now);
  const users = await prisma.user.findMany({
    where: { id: { in: [...byMember.keys()] } },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => {
    const inputs = byMember.get(u.id)!;
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      score: memberScore({ today: now, ...inputs }),
    };
  });
}
