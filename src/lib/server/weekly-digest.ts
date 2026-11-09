// The Sunday mail: what is waiting on each member, in one message a week. Sections: card transactions with no
// utlägg (holders), own claims near the filing deadline (submitters), utlägg awaiting their attest (see attestersOf).
// Empty sections are left out and a member with nothing gets no mail, which is why it cannot be switched off.
// Run by app/api/cron/weekly-digest; a week gets one digest however often it is asked.
import "server-only";

import { prisma } from "@/lib/server/db";
import { attestersOf, notify } from "@/lib/server/notify";
import {
  digestEmail,
  emailT,
  formatOre,
  mailLabel,
  statusLabel,
  type ListRow,
  type Waiting,
} from "@/lib/email/content";
import type { Email } from "@/lib/email/types";
import { daysAgo, isoWeek, stockholmDay, today as stockholmToday, isoDay } from "@/lib/domain/date";
import { REIMBURSEMENT_DEADLINE_DAYS, SUBMITTABLE_STATUSES } from "@/lib/domain/status";

// How close to the deadline a claim has to be before the digest mentions it (two digests' worth).
const DEADLINE_WARNING_DAYS = 14;

/** Queue this week's digest for everyone with something in it. */
export async function queueWeeklyDigest(today = stockholmToday()): Promise<{ queued: number }> {
  const waiting = await collectWaiting(today);
  const week = isoWeek(today);
  let queued = 0;
  for (const [userId, w] of waiting) {
    queued += await notify(prisma, "WEEKLY_DIGEST", [userId], (p) => digestEmail(p.name, week, w), {
      dedupeKey: (id) => `weekly-digest:${id}:${week}`,
    });
  }
  return { queued };
}

/** What this week's digest would say to one member today (for the test mail, lib/server/test-email.ts). Null when nothing is waiting. */
export async function digestFor(
  user: { id: string; name: string },
  today = stockholmToday(),
): Promise<Email | null> {
  const w = (await collectWaiting(today)).get(user.id);
  return w ? digestEmail(user.name, isoWeek(today), w) : null;
}

/** Everything waiting on anybody, by member. A member with nothing is absent. */
async function collectWaiting(today: string): Promise<Map<string, Waiting>> {
  const waiting = new Map<string, Waiting>();
  const of = (userId: string) => {
    const w = waiting.get(userId) ?? {};
    waiting.set(userId, w);
    return w;
  };

  const unmatched = await prisma.bankTransaction.findMany({
    where: { matchedExpense: { is: null }, card: { holderId: { not: null } } },
    select: {
      transactionDate: true,
      description: true,
      amount: true,
      card: { select: { holderId: true } },
    },
  });
  for (const t of unmatched) (of(t.card!.holderId!).unmatched ??= []).push(t);

  // Not yet sent, out of pocket, no dispens, between the warning window and the deadline.
  const earliest = new Date(`${today}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - REIMBURSEMENT_DEADLINE_DAYS);
  const latest = new Date(`${today}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() - (REIMBURSEMENT_DEADLINE_DAYS - DEADLINE_WARNING_DAYS));
  const nearDeadline = await prisma.expense.findMany({
    where: {
      status: { in: SUBMITTABLE_STATUSES },
      paymentType: { in: ["REIMBURSEMENT", "MILEAGE"] },
      deadlineWaivedAt: null,
      purchaseDate: { gte: earliest, lte: latest },
    },
    orderBy: { purchaseDate: "asc" },
    select: {
      reference: true,
      title: true,
      status: true,
      purchaseDate: true,
      submitterId: true,
    },
  });
  for (const e of nearDeadline) {
    const bought = isoDay(e.purchaseDate!);
    (of(e.submitterId).deadline ??= []).push({
      title: mailLabel(e),
      sub: emailT("digest.deadlineSub", {
        status: statusLabel(e.status),
        date: bought,
      }),
      pill: emailT("digest.deadlineLeft", {
        left: REIMBURSEMENT_DEADLINE_DAYS - daysAgo(bought, today),
      }),
    });
  }

  // Asked per utlägg, of only the allocations still unsigned. Oldest first, counted from when last sent in.
  const pending = await prisma.expense.findMany({
    where: { status: "PENDING_APPROVAL" },
    orderBy: { createdAt: "asc" },
    select: {
      reference: true,
      title: true,
      grossAmount: true,
      submitterId: true,
      submitter: { select: { name: true } },
      allocations: {
        where: { approvedById: null },
        select: { costCenter: { select: { code: true } } },
      },
      events: {
        where: { type: "SUBMITTED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });
  const bySubmission = pending
    .map((e) => ({ e, sent: e.events[0] ? stockholmDay.format(e.events[0].createdAt) : today }))
    .sort((a, b) => a.sent.localeCompare(b.sent));
  for (const { e, sent } of bySubmission) {
    if (e.allocations.length === 0) continue;
    const ids = await attestersOf(
      e.allocations.map((a) => ({ costCenterCode: a.costCenter.code })),
      e.submitterId,
    );
    const row: ListRow = {
      title: mailLabel(e),
      sub: emailT("digest.attestSub", {
        submitter: e.submitter.name,
        days: daysAgo(sent, today),
      }),
      amount: formatOre(e.grossAmount ?? 0),
    };
    for (const id of ids) (of(id).attest ??= []).push(row);
  }

  return waiting;
}
