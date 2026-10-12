// The Sunday mail: what is waiting on each member, in one message a week.
//
// Three sections, each about something only the reader can move:
//
//   card transactions with no utlägg against them, refunds included (holders)
//   their own out-of-pocket claims close to the filing deadline (submitters)
//   utlägg waiting for their attest (attesters, the same people the
//     SUBMITTED mail asks; see attestersOf)
//
// A section with nothing in it is left out, and a member with nothing in any
// of them gets no mail. That silence is what lets the digest be the one mail
// that cannot be switched off.
//
// Run by the cron route (app/api/cron/weekly-digest). The day it runs on is the
// CronJob's to decide; this only makes sure a week gets one digest however
// often it is asked.
import "server-only";

import { prisma } from "@/lib/server/db";
import { attestersOf, notify } from "@/lib/server/notify";
import {
  digestEmail,
  emailT,
  formatOre,
  isoDay,
  mailLabel,
  statusLabel,
  type ListRow,
  type Waiting,
} from "@/lib/email/content";
import type { Email } from "@/lib/email/types";
import { daysAgo, isoWeek, stockholmDay, today as stockholmToday } from "@/lib/domain/date";
import { REIMBURSEMENT_DEADLINE_DAYS, SUBMITTABLE_STATUSES } from "@/lib/domain/status";

// How close to the deadline a claim has to be before the digest mentions it.
// Two digests' worth: a claim is named twice before it runs out, never once
// and then too late.
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

/**
 * What this week's digest would say to one member, if it went out today. For
 * the test mail in Inställningar (lib/server/test-email.ts). Collects for the
 * whole section and keeps one member's, which is the same work the Sunday run
 * does and keeps the two from ever disagreeing about what is waiting.
 *
 * Null when nothing is waiting on them, which is a digest that would not be
 * sent at all.
 */
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

  // ── Card transactions with no utlägg ──
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

  // ── Own claims close to the filing deadline ──
  //
  // Not yet sent, out of pocket, no dispens, and between the warning window
  // and the deadline itself. Past it, the claim cannot be sent at all and a
  // reminder would only be a reproach.
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
    select: { reference: true, title: true, status: true, purchaseDate: true, submitterId: true },
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

  // ── Waiting for your attest ──
  //
  // Asked per utlägg, of only the allocations still unsigned, so a
  // resultatansvarig who has signed their part is not reminded of the rest.
  // Oldest first, counted from when it was last sent in.
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
      sub: emailT("digest.attestSub", { submitter: e.submitter.name, days: daysAgo(sent, today) }),
      amount: formatOre(e.grossAmount ?? 0),
    };
    for (const id of ids) (of(id).attest ??= []).push(row);
  }

  return waiting;
}
