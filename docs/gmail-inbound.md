# Levfakturor by mail: setting up the Gmail inkorg

Members forward supplier invoices to one mailbox, and each PDF shows up in
the app's Inkorg (Bokföring → Fakturainkorg) a few seconds later. This page
is the one-time setup. Everything in the Google Cloud project can be done
with an ordinary project role. A Workspace admin is only needed for the
mailbox itself and for checking DKIM.

How it fits together:

```
member forwards ─▶ fakturor@dsek.se ─▶ Gmail ─▶ Pub/Sub topic
                                                    │ push, signed by Google
                                                    ▼
                                    ekonomi app /api/inbound/gmail
                                                    │ reads the mail
                                                    ▼
                                    Gmail API (read-only, logged in as the mailbox)
```

The push carries no mail, only "something changed". The app then reads the
mailbox itself, with a login stored when someone connected the mailbox from
the Inkorg. It only ever **reads**. It never sends from the mailbox, deletes
from it or marks anything read, so the mailbox stays a complete archive of
what was forwarded.

## 1. The mailbox

Create a Workspace user, for example `fakturor@dsek.se`, with a licence that
includes Gmail. A real user, not a group or an alias: the Gmail API reads a
user's mailbox.

If dsek.se users are synced from authentik by GCDS, create the user in
authentik too, or GCDS may suspend it.

Tell members to forward invoices there from their **@dsek.se** address. Mail
from anywhere else is refused (see "What gets refused" below).

## 2. A Google Cloud project

In [console.cloud.google.com](https://console.cloud.google.com):

1. Create a project, for example `dsek-ekonomi`, in the dsek.se
   organisation. Note its **project ID**.
2. **APIs & Services → Library**: enable **Gmail API** and **Cloud Pub/Sub API**.

## 3. The OAuth client

**Google Auth Platform** (or **APIs & Services → OAuth consent screen**):

1. **Branding**: app name `Ekonomi inkorg`, support email your own address
   or a group you manage.
2. **Audience**: **Internal**. Only dsek.se accounts can log in, no Google
   review is needed, and the login does not run out after a week.
3. **Data access → Add or remove scopes**:
   `https://www.googleapis.com/auth/gmail.readonly`.
4. **Clients → Create client → Web application**, name `ekonomi-gmail`.
   Authorised redirect URI: `https://ekonomi.dsek.se/api/gmail/callback`
   (and `http://localhost:3000/api/gmail/callback` for local testing).
   Copy the **client ID** and the **client secret**. The secret is shown
   once.

## 4. Pub/Sub

1. **IAM & Admin → Service accounts → Create**: `ekonomi-pubsub-push`. No
   roles and no key. It is only the identity Pub/Sub signs its pushes as.
2. **Pub/Sub → Topics → Create topic**: `ekonomi-inkorg`. Untick "Add a
   default subscription".
3. On the topic, **Permissions → Add principal**:
   `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**.
   This is Google's own account that Gmail publishes from. If an org policy
   (domain restricted sharing) refuses it, someone with an organisation role
   has to allow it for the project.
4. **Subscriptions → Create subscription** on that topic:
   - Delivery type: **Push**
   - Endpoint URL: `https://ekonomi.dsek.se/api/inbound/gmail`
   - **Enable authentication**, service account: `ekonomi-pubsub-push`
   - Audience: the endpoint URL again, exactly as above
   - Expiration period: **Never expire** (by default a subscription deletes
     itself after 31 days without traffic)
   - Acknowledgement deadline: **60 seconds** (a mail with several PDFs
     takes a few seconds to read)
   - Retry policy: exponential backoff

Not Pub/Sub Lite: it has no push, and Gmail cannot publish to it.

## 5. The app's configuration

Set these in the deployment (see `.env.example`). Only the client secret is
secret:

| Variable | Value |
|---|---|
| `GMAIL_MAILBOX` | `fakturor@dsek.se` |
| `GMAIL_OAUTH_CLIENT_ID` | the client ID from step 3 |
| `GMAIL_OAUTH_CLIENT_SECRET` | the client secret from step 3 |
| `GMAIL_PUBSUB_TOPIC` | `projects/<project>/topics/ekonomi-inkorg` |
| `GMAIL_PUSH_AUDIENCE` | the endpoint URL from step 4, exactly |
| `GMAIL_PUSH_SERVICE_ACCOUNT` | `ekonomi-pubsub-push@<project>.iam.gserviceaccount.com` |
| `INBOUND_ALLOWED_DOMAIN` | optional, defaults to `dsek.se` |

Until all six `GMAIL_*` are set the integration is off, and the Inkorg only
fills by hand.

## 6. The scheduled job

Add a CronJob next to the existing ones, **hourly**:

```
POST /api/cron/gmail-sync
Authorization: Bearer <CRON_SECRET>
```

It renews Gmail's watch before it runs out (a watch lasts seven days) and
reads anything a push missed. While the mailbox is not connected it answers
`{"connected": false}` and does nothing.

## 7. Connect the mailbox

As someone with settings access, open **Bokföring → Fakturainkorg**. The
**Inkorgens mejlkonto** card at the foot says "Inte kopplad". Click
**Koppla inkorgen**, log in to Google as `fakturor@dsek.se` and allow
read access. The app refuses a login to any other account. Back in the
Inkorg, the card says who connected it and when, and the watch is started.

The login stops working if the mailbox's password is changed or the access
is removed under the account's security settings. The card then says "Inte
kopplad" again, and the fix is to click **Koppla inkorgen** once more. Mail
that arrived meanwhile is read on reconnect, up to a week back.

**Koppla från** stops the watch, withdraws the login at Google and forgets
it.

## 8. Try it

Forward an invoice PDF from your @dsek.se address to the mailbox, with
"SEX01" (or any cost centre code) in the text. Within a few seconds it should
be in that unit's Inkorg, and its resultatansvariga get a mail.

If it is not, look at the mailbox card. It shows when the mailbox was last
read, the last error, and any mail that was refused, with the reason.

## What gets refused

A mail is refused, and no document is made, when:

- its From address is not `@dsek.se`, or
- Gmail could not verify that it really came from dsek.se: neither DMARC
  passed for dsek.se nor a DKIM signature from dsek.se verified, or
- it has no PDF attached.

**Check this on the first test.** The check reads the Authentication-Results
header Gmail adds. If a forward between two dsek.se accounts shows up as
refused with "avsändaren kunde inte verifieras", open the original in Gmail
("Show original") and look at its `Authentication-Results` line. The usual
cause is that DKIM signing is not switched on for dsek.se under **Apps →
Google Workspace → Gmail → Authenticate email** in the admin console.

## What one mail becomes

- Each attached PDF becomes a document in the Inkorg. Other attachments
  (images, signatures) are ignored.
- What the forwarder wrote above the forwarded message is kept, and shown
  when the document is opened. For a mail with exactly one PDF it also
  decides whose the invoice is, and the document goes straight to that
  unit to fördela:
  1. a cost centre code (`SEX01`), when all codes named belong to one unit,
  2. a unit named in full (`Sexmästeriet`), when exactly one is,
  3. otherwise the forwarder's unit, if they answer for exactly one.

  Anything else, and every mail with several PDFs, stays in the Inkorg for
  triage to give to a unit.
