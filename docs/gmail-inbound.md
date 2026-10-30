# Levfakturor by mail: setting up the Gmail inkorg

Members forward supplier invoices to one mailbox, and each one shows up on
the app's Leverantörsfakturor page a few seconds later. This page is the
one-time setup. It needs someone with **Google Workspace super admin** rights
for dsek.se (steps 1 and 4) and someone who can edit the app's deployment
secrets (step 5).

How it fits together:

```
member forwards ─▶ fakturor@dsek.se ─▶ Gmail ─▶ Pub/Sub topic
                                                    │ push, signed by Google
                                                    ▼
                                    ekonomi app /api/inbound/gmail
                                                    │ reads the mail
                                                    ▼
                                    Gmail API (read-only, as the mailbox)
```

The app only ever **reads** the mailbox. It never sends from it, deletes from
it or marks anything read, so the mailbox stays a complete archive of what
was forwarded.

## 1. The mailbox

Create a Workspace user, for example `fakturor@dsek.se`. A real user, not a
group or an alias: the Gmail API reads a user's mailbox.

Tell members to forward invoices there from their **@dsek.se** address. Mail
from anywhere else is refused (see "What gets refused" below).

## 2. A Google Cloud project

In [console.cloud.google.com](https://console.cloud.google.com), signed in as
someone in the dsek.se organisation:

1. Create a project, for example `dsek-ekonomi`.
2. **APIs & Services → Enable APIs**: enable **Gmail API** and **Cloud Pub/Sub API**.

## 3. Two service accounts

**IAM & Admin → Service accounts → Create**:

- `ekonomi-gmail`: reads the mailbox. No project roles needed. Under
  **Keys → Add key → JSON**, download a key. Keep it secret. Note its
  **Client ID** (a long number) and its email.
- `ekonomi-pubsub-push`: the identity Pub/Sub signs its pushes as. No roles
  and no key needed. Note its email.

## 4. Domain-wide delegation (Workspace admin)

In [admin.google.com](https://admin.google.com): **Security → Access and data
control → API controls → Manage domain-wide delegation → Add new**:

- Client ID: the `ekonomi-gmail` client ID from step 3
- OAuth scopes: `https://www.googleapis.com/auth/gmail.readonly`

That one scope, nothing broader. It lets the service account read mailboxes
when it asks to act as a specific user. The app only ever asks to act as the
mailbox in `GMAIL_MAILBOX`.

## 5. Pub/Sub

In the Cloud project, **Pub/Sub**:

1. **Topics → Create topic**, for example `ekonomi-inkorg`. Untick "Add a
   default subscription".
2. On the topic, **Permissions → Add principal**:
   `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**.
   This is Google's own account that Gmail publishes from.
3. **Subscriptions → Create subscription** on that topic:
   - Delivery type: **Push**
   - Endpoint URL: `https://<APP_URL host>/api/inbound/gmail`
   - **Enable authentication**, service account: `ekonomi-pubsub-push`
   - Audience: the endpoint URL again, exactly as above
   - Acknowledgement deadline: **60 seconds** (a mail with several PDFs
     takes a few seconds to read)
   - Retry policy: exponential backoff

## 6. The app's configuration

Set these in the deployment's secrets (see `.env.example`):

| Variable | Value |
|---|---|
| `GMAIL_MAILBOX` | `fakturor@dsek.se` |
| `GMAIL_SERVICE_ACCOUNT_EMAIL` | `ekonomi-gmail@<project>.iam.gserviceaccount.com` |
| `GMAIL_SERVICE_ACCOUNT_KEY` | the `private_key` field from the JSON key, with its newlines as `\n` |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project>/topics/ekonomi-inkorg` |
| `GMAIL_PUSH_AUDIENCE` | the endpoint URL from step 5, exactly |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `ekonomi-pubsub-push@<project>.iam.gserviceaccount.com` |
| `INBOUND_ALLOWED_DOMAIN` | optional, defaults to `dsek.se` |

Until all six `GMAIL_*` are set the integration is off, and the inkorg only
fills by hand.

## 7. The scheduled job

Add a CronJob next to the existing ones, **hourly**:

```
POST /api/cron/gmail-sync
Authorization: Bearer <CRON_SECRET>
```

It starts Gmail's watch the first time, renews it before it runs out (a
watch lasts seven days), and reads anything a push missed. Run it once by hand
after deploying to start the watch. Until then no pushes arrive.

## 8. Try it

Forward an invoice PDF from your @dsek.se address to the mailbox, with
"SEX01" (or any cost centre code) in the text. Within a few seconds it should
be on Leverantörsfakturor, given to that cost centre's unit.

If it is not, look at the **Inkorgens mejlkonto** card at the foot of the list
(visible to triage). It shows when the mailbox was last read, the last error,
and any mail that was refused, with the reason.

## What gets refused

A mail is refused, and no invoice is made, when:

- its From address is not `@dsek.se`, or
- Gmail could not verify that it really came from dsek.se: neither DMARC
  passed for dsek.se nor a DKIM signature from dsek.se verified.

**Check this on the first test.** The check reads the Authentication-Results
header Gmail adds. If a forward between two dsek.se accounts shows up as
refused with "avsändaren kunde inte verifieras", open the original in Gmail
("Show original") and look at its `Authentication-Results` line. The usual
cause is that DKIM signing is not switched on for dsek.se under **Apps →
Google Workspace → Gmail → Authenticate email** in the admin console.

## What one mail becomes

- One invoice per attached PDF. Other attachments (images, signatures) are
  ignored.
- A mail with no PDF still becomes one invoice, with the mail shown, so the
  PDF can be added by hand.
- What the forwarder wrote above the forwarded message is kept, and used to
  put a lone PDF straight into a unit's Inkorg, for the unit to fördela:
  1. a cost centre code (`SEX01`), when all codes named belong to one unit,
  2. a unit named in full (`Sexmästeriet`), when exactly one is,
  3. otherwise the forwarder's unit, if they answer for exactly one.
  
  Anything else stays in the inkorg for triage. When an earlier invoice from
  the same original sender went to a unit, triage is offered that unit as a
  suggestion.
