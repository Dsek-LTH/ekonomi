// The redovisningsbetyg as the pages read it: the database turned into what
// lib/domain/member-score.ts scores, for one member or for all of them.
//
// Who may ask for whose is the page's to check (canViewMemberScores, or the
// member's own on /profile). Nothing here narrows by viewer.
import "server-only";

import { prisma } from "@/lib/server/db";
import { stockholmDay, today } from "@/lib/domain/date";
import {
  SCORE_WINDOW_DAYS,
  memberScore,
  type MemberScore,
  type ScoreCardPurchase,
  type ScoreExpense,
} from "@/lib/domain/member-score";

/** Statuses an utlägg is only in once every row is attested. */
const ATTESTED = new Set(["APPROVED", "BOOKED", "EXPORTED"]);

const dateDay = (d: Date) => d.toISOString().slice(0, 10); // a @db.Date column
const momentDay = (d: Date) => stockholmDay.format(d); // a timestamp, on the section's calendar
const later = (a: string, b: string) => (a > b ? a : b);

function windowStart(now: string): Date {
  const d = new Date(`${now}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - SCORE_WINDOW_DAYS);
  return d;
}

/** Every input the score needs, for the given members or for everybody. */
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
          where: { type: { in: ["SUBMITTED", "CHANGES_REQUESTED"] } },
          select: { type: true, createdAt: true },
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

  const byMember = new Map<string, { expenses: ScoreExpense[]; cardPurchases: ScoreCardPurchase[] }>();
  const of = (id: string) => {
    let m = byMember.get(id);
    if (!m) byMember.set(id, (m = { expenses: [], cardPurchases: [] }));
    return m;
  };

  for (const e of expenses) {
    const bought = e.purchaseDate ? dateDay(e.purchaseDate) : momentDay(e.createdAt);
    // A card purchase can only be sent once its bank row is in the app to
    // match, so its clock waits for the import. Without a row it has not
    // started.
    const startedOn =
      e.paymentType === "CARD"
        ? e.matchedTransaction
          ? later(bought, momentDay(e.matchedTransaction.importedAt))
          : null
        : bought;
    const submitted = e.events.find((ev) => ev.type === "SUBMITTED");
    const returned = e.events.some((ev) => ev.type === "CHANGES_REQUESTED");
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
      startedOn: later(dateDay(t.transactionDate), momentDay(t.importedAt)),
    });
  }
  return byMember;
}

/** One member's score. */
export async function getMemberScore(userId: string): Promise<MemberScore> {
  const now = today();
  const inputs = (await load([userId], now)).get(userId);
  return memberScore({ today: now, expenses: inputs?.expenses ?? [], cardPurchases: inputs?.cardPurchases ?? [] });
}

/** One member's score with who they are, or null for nobody by that id. */
export async function getMemberScoreRow(userId: string): Promise<MemberScoreRow | null> {
  const [user, score] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true } }),
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

/** Everybody with anything in the window to score, for the treasury's list. */
export async function getMemberScores(): Promise<MemberScoreRow[]> {
  const now = today();
  const byMember = await load(null, now);
  const users = await prisma.user.findMany({
    where: { id: { in: [...byMember.keys()] } },
    select: { id: true, name: true, email: true },
  });
  return users.map((u) => {
    const inputs = byMember.get(u.id)!;
    return { userId: u.id, name: u.name, email: u.email, score: memberScore({ today: now, ...inputs }) };
  });
}
