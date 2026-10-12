// Reminders, sent by hand: about utlägg, and about card purchases with no
// utlägg yet. See lib/server/reminders.ts.
//
//   GET  ?expenses=a,b&transactions=c,d   who a reminder about these would
//                                         reach, for the dialog to show
//                                         before anything is sent
//   POST { expenseIds, transactionIds, message? }   send it
//
// Both gated on SEND_REMINDERS, and both only ever see what the sender could
// open themselves.
import { NextResponse } from "next/server";
import { canSendReminders } from "@/lib/domain/permissions";
import { MAX_REMINDER_ITEMS, type ReminderPreview } from "@/lib/domain/reminders";
import { deliverSoon } from "@/lib/server/notify";
import { planReminders, sendReminders, type ReminderPlan } from "@/lib/server/reminders";
import { fail, gate } from "@/lib/api/guard";
import { parseBody } from "@/lib/api/parse";
import { SendReminders } from "@/lib/api/schemas/expense";

/** The plan as the dialog reads it: the mail each one would carry stays here. */
const forClient = (plan: ReminderPlan): ReminderPreview => ({
  items: plan.items.map(({ id, subject, label, target, recipients }) => ({
    id,
    subject,
    label,
    target,
    recipients,
  })),
  skipped: plan.skipped,
});

const ids = (params: URLSearchParams, key: string) =>
  (params.get(key) ?? "").split(",").filter(Boolean).slice(0, MAX_REMINDER_ITEMS);

export async function GET(req: Request) {
  const g = await gate(canSendReminders, "reminder.denied");
  if (!g.ok) return g.res;

  const params = new URL(req.url).searchParams;
  const plan = await planReminders(g.actor, {
    expenseIds: ids(params, "expenses"),
    transactionIds: ids(params, "transactions"),
  });
  return NextResponse.json(forClient(plan));
}

export async function POST(req: Request) {
  const g = await gate(canSendReminders, "reminder.denied");
  if (!g.ok) return g.res;

  const parsed = await parseBody(req, SendReminders);
  if (!parsed.ok) return parsed.res;

  const plan = await planReminders(g.actor, parsed.data);
  if (plan.items.length === 0) return fail(409, "reminder.nobody");

  const sent = await sendReminders(g.actor, plan, parsed.data.message ?? null);
  deliverSoon();
  return NextResponse.json({ ...sent, skipped: plan.skipped.length });
}
