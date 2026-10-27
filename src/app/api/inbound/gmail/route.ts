// POST /api/inbound/gmail: Pub/Sub's push when something arrives in the
// levfaktura inkorg mailbox.
//
// The notification itself says only that the mailbox changed, so it is not
// read beyond being checked to come from our subscription. What changed is
// read from Gmail, from where the last sync stopped (lib/server/inbound-mail.ts).
//
// It answers 204 even when the sync fails. Pub/Sub would otherwise redeliver
// the same notification for a week, and nothing would be gained by it: the
// failed mail is retried by the next push or the cron sync anyway, because the
// history id only moves past a mail once it has been handled. The failure is
// in the log and in GmailSync.lastError, which triage sees on /invoices.
import { gmailConfig, verifyPushToken } from "@/lib/server/gmail";
import { syncInbox } from "@/lib/server/inbound-mail";
import { fail } from "@/lib/api/guard";

export async function POST(req: Request) {
  const c = gmailConfig();
  // Off, it is not there, the same answer the cron routes give without a secret.
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
