// POST /api/inbound/gmail: Pub/Sub's push when something arrives in the levfaktura inkorg mailbox. Only
// checked to come from our subscription; what changed is read from Gmail (lib/server/inbound-mail.ts).
// Answers 204 even when the sync fails: Pub/Sub would redeliver for a week, and the next push or cron sync
// retries anyway (the failure is in the log and GmailSync.lastError).
import { gmailConfig, verifyPushToken } from "@/lib/server/gmail";
import { syncInbox } from "@/lib/server/inbound-mail";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request) {
  const c = gmailConfig();
  // Off: not there, the same answer the cron routes give without a secret.
  if (!c) return fail(404, "notFound");
  if (!(await verifyPushToken(c, req.headers.get("authorization")))) {
    return fail(401, "auth.denied");
  }

  try {
    const result = await syncInbox();
    console.info("[inbound-mail] push sync", result);
  } catch (err) {
    console.error("[inbound-mail] push sync failed", err);
  }
  return new Response(null, { status: 204 });
}
