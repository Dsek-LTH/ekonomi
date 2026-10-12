// Reminding whoever something is waiting on, by hand: an utlägg, or a card
// purchase nobody has accounted for yet.
//
// Two steps, so the dialog can say who a reminder will reach before anybody
// presses send:
//
//   planReminders()  which of the picked things can be reminded about, and who
//                    each one would reach. Nothing written.
//   sendReminders()  one mail per person, covering everything in the plan that
//                    waits on them, and a line in each utlägg's history.
//
// Who is reached is the rule in lib/domain/reminders.ts: an utlägg's attesters
// still to sign or its submitter, and a card purchase's holder. The sender is
// never among them. Reminders are not something a member can switch off;
// somebody chose to send this one.
import "server-only";

import { prisma } from "@/lib/server/db";
import { attestersOf, notify } from "@/lib/server/notify";
import { expenseScopeOf, expenseScopeWhere } from "@/lib/data/expense-scope";
import { canAccessBookkeeping } from "@/lib/domain/permissions";
import {
  reminderTarget,
  type ReminderPreview,
  type ReminderSubject,
  type ReminderTarget,
} from "@/lib/domain/reminders";
import {
  formatSignedOre,
  isoDay,
  mailLabel,
  reminderEmail,
  type ReminderItem,
  type Txn,
} from "@/lib/email/content";
import type { Actor } from "@/lib/api/guard";

export interface PlannedReminder {
  id: string;
  subject: ReminderSubject;
  label: string;
  target: ReminderTarget;
  recipients: { id: string; name: string }[];
  /** What the mail says about it: an utlägg, or a row of the card table. */
  item: { expense: ReminderItem } | { txn: Txn };
}

/** Not waiting on anybody (signed, or already accounted for); or waiting on
 *  people of whom none is left to remind (all inactive, or only the sender). */
export type SkippedReminder = ReminderPreview["skipped"][number];

export interface ReminderPlan {
  items: PlannedReminder[];
  skipped: SkippedReminder[];
}

/**
 * Who a reminder about each of these would reach, as `actor` sends it.
 *
 * Only what the sender could open is considered. Anything outside their scope
 * is left out entirely, the same "not found" it is everywhere else, so a
 * reminder cannot be used to learn that somebody else's utlägg or purchase
 * exists.
 */
export async function planReminders(
  actor: Actor,
  picked: { expenseIds: readonly string[]; transactionIds: readonly string[] },
): Promise<ReminderPlan> {
  const [expenses, txns] = await Promise.all([
    planExpenses(actor, picked.expenseIds),
    planTransactions(actor, picked.transactionIds),
  ]);
  const plan: ReminderPlan = {
    items: [...expenses.items, ...txns.items],
    skipped: [...expenses.skipped, ...txns.skipped],
  };

  // Named in one query, once everybody's ids are known.
  const ids = new Set(plan.items.flatMap((i) => i.recipients.map((r) => r.id)));
  if (ids.size) {
    const people = await prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    const names = new Map(people.map((p) => [p.id, p.name]));
    for (const i of plan.items) {
      i.recipients = i.recipients
        .map((r) => ({ id: r.id, name: names.get(r.id) ?? "" }))
        .sort((a, b) => a.name.localeCompare(b.name, "sv"));
    }
  }
  return plan;
}

async function planExpenses(actor: Actor, expenseIds: readonly string[]): Promise<ReminderPlan> {
  if (expenseIds.length === 0) return { items: [], skipped: [] };
  const scope = await expenseScopeOf(actor);
  const expenses = await prisma.expense.findMany({
    where: { AND: [{ id: { in: [...expenseIds] } }, expenseScopeWhere(scope)] },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      reference: true,
      title: true,
      status: true,
      grossAmount: true,
      purchaseDate: true,
      paymentType: true,
      submitterId: true,
      submitter: { select: { name: true, active: true } },
      allocations: {
        select: { approvedById: true, costCenter: { select: { code: true, name: true } } },
      },
    },
  });

  const plan: ReminderPlan = { items: [], skipped: [] };
  for (const e of expenses) {
    const label = mailLabel(e);
    const target = reminderTarget(e.status);
    if (!target) {
      plan.skipped.push({ id: e.id, label, reason: "notRemindable" });
      continue;
    }

    let ids: string[];
    if (target === "attesters") {
      // Only the allocations still unsigned: a resultatansvarig who has signed
      // their part is not reminded of the rest. The same people the SUBMITTED
      // mail and the digest ask.
      const unsigned = e.allocations.filter((a) => !a.approvedById);
      ids = unsigned.length
        ? await attestersOf(
            unsigned.map((a) => ({ costCenterCode: a.costCenter.code })),
            e.submitterId,
          )
        : [];
    } else {
      ids = e.submitter.active ? [e.submitterId] : [];
    }
    ids = ids.filter((id) => id !== actor.id);
    if (ids.length === 0) {
      plan.skipped.push({ id: e.id, label, reason: "nobody" });
      continue;
    }

    plan.items.push({
      id: e.id,
      subject: "expense",
      label,
      target,
      recipients: ids.map((id) => ({ id, name: "" })),
      item: {
        expense: {
          expense: e,
          state: target === "attesters" ? "attest" : e.status === "DRAFT" ? "draft" : "changes",
          submitter: e.submitter.name,
        },
      },
    });
  }
  return plan;
}

async function planTransactions(
  actor: Actor,
  transactionIds: readonly string[],
): Promise<ReminderPlan> {
  if (transactionIds.length === 0) return { items: [], skipped: [] };
  // The section's feed is bookkeeping's to read; anybody else sees only their
  // own card, and has nobody but themselves to remind about it.
  const txns = await prisma.bankTransaction.findMany({
    where: {
      id: { in: [...transactionIds] },
      ...(canAccessBookkeeping(actor.capabilities) ? {} : { card: { holderId: actor.id } }),
    },
    orderBy: { transactionDate: "asc" },
    select: {
      id: true,
      transactionDate: true,
      description: true,
      amount: true,
      matchedExpense: { select: { id: true } },
      card: { select: { holder: { select: { id: true, active: true } } } },
    },
  });

  const plan: ReminderPlan = { items: [], skipped: [] };
  for (const t of txns) {
    const label = `${isoDay(t.transactionDate)} ${t.description} ${formatSignedOre(t.amount)}`;
    if (t.matchedExpense) {
      plan.skipped.push({ id: t.id, label, reason: "notRemindable" });
      continue;
    }
    const holder = t.card?.holder;
    if (!holder || !holder.active || holder.id === actor.id) {
      plan.skipped.push({ id: t.id, label, reason: "nobody" });
      continue;
    }
    plan.items.push({
      id: t.id,
      subject: "transaction",
      label,
      target: "cardHolder",
      recipients: [{ id: holder.id, name: "" }],
      item: { txn: t },
    });
  }
  return plan;
}

/**
 * Send the reminders a plan describes: one mail to each person, about
 * everything in it that waits on them, and a REMINDER_SENT line in each
 * utlägg's history naming who it went to. A card purchase has no history of
 * its own to write to; its reminder is in the mail log (Inställningar →
 * E-post) and nowhere else.
 *
 * Returns how many people and things that was. The caller sends the outbox
 * afterwards (`deliverSoon`), as after any write.
 */
export async function sendReminders(
  actor: Actor,
  plan: ReminderPlan,
  message: string | null,
): Promise<{ people: number; items: number }> {
  const byPerson = new Map<string, { expenses: ReminderItem[]; txns: Txn[] }>();
  for (const i of plan.items) {
    for (const r of i.recipients) {
      const mine = byPerson.get(r.id) ?? { expenses: [], txns: [] };
      if ("expense" in i.item) mine.expenses.push(i.item.expense);
      else mine.txns.push(i.item.txn);
      byPerson.set(r.id, mine);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const [personId, { expenses, txns }] of byPerson) {
      await notify(
        tx,
        "EXPENSE_REMINDER",
        [personId],
        reminderEmail(actor.name, message, expenses, txns),
      );
    }
    await tx.expenseEvent.createMany({
      data: plan.items
        .filter((i) => i.subject === "expense")
        .map((i) => ({
          expenseId: i.id,
          type: "REMINDER_SENT" as const,
          actorId: actor.id,
          comment: message,
          diff: { recipients: i.recipients.map((r) => r.name) },
        })),
    });
  });

  return { people: byPerson.size, items: plan.items.length };
}
