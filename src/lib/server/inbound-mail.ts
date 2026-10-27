// Turning mail in the levfaktura inkorg mailbox into invoices.
//
// Called from two places: the Pub/Sub push (api/inbound/gmail), seconds after
// a mail arrives, and the cron job (api/cron/gmail-sync), which renews Gmail's
// watch and also syncs, so a push that never came is picked up within the
// hour. Both run `syncInbox`, which reads everything since the history id it
// last finished at. Running it twice at once is safe: each mail is claimed by
// writing its InboundMail row first, and its Gmail id is unique.
//
// What one mail becomes:
//
//   • from outside dsek.se, or not verified by Gmail: a REJECTED row saying
//     why, and nothing else. Triage sees the latest of them on /invoices.
//   • otherwise one INBOX invoice per PDF attached (or a single one with no
//     document, when the mail carried none, so the PDF can be added by hand),
//     each given to a result unit at once when what the forwarder wrote
//     settles whose it is (autoAssign in lib/domain/inbound-mail.ts).
import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/db";
import {
  deleteObjectBestEffort,
  putObject,
  supplierInvoiceDocumentKey,
} from "@/lib/server/storage";
import { getPrefixes, ownedResultUnits, resultUnitForCode } from "@/lib/server/result-units";
import { deliverSoon, notify } from "@/lib/server/notify";
import { prefillData, readInvoicePdf } from "@/lib/server/invoice-prefill";
import type { InvoiceTextFields } from "@/lib/domain/invoice-text";
import { invoiceNotice } from "@/lib/email/content";
import { SNIFF_BYTES, sniffReceiptType } from "@/lib/domain/file-type";
import {
  autoAssign,
  cleanSubject,
  parseAddress,
  rejectReason,
  splitForward,
  type AutoAssignment,
} from "@/lib/domain/inbound-mail";
import {
  GmailError,
  currentHistoryId,
  getAttachment,
  getMessage,
  gmailConfig,
  messagesAddedSince,
  recentMessages,
  watch,
  type GmailPart,
} from "./gmail";

type Config = NonNullable<ReturnType<typeof gmailConfig>>;

// The same ceiling a hand upload has (lib/server/document-upload.ts).
const MAX_BYTES = 25 * 1024 * 1024;

// ── Reading a message ─────────────────────────────────────────────

const headerValues = (part: GmailPart, name: string): string[] =>
  (part.headers ?? []).filter((h) => h.name.toLowerCase() === name.toLowerCase()).map((h) => h.value);

function* walk(part: GmailPart): Generator<GmailPart> {
  yield part;
  for (const p of part.parts ?? []) yield* walk(p);
}

const decode = (data: string | undefined) => (data ? Buffer.from(data, "base64url").toString("utf8") : "");

/** The mail's text: its first text/plain part, or its HTML with the tags
 *  taken out when it has no plain one. Attachments are not text. */
function bodyText(payload: GmailPart): string {
  const inline = [...walk(payload)].filter((p) => !p.filename);
  const plain = inline.find((p) => p.mimeType === "text/plain");
  if (plain) return decode(plain.body?.data);
  const html = inline.find((p) => p.mimeType === "text/html");
  if (!html) return "";
  return decode(html.body?.data)
    .replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

/** The PDFs attached, by what they say they are. Whether they really are is
 *  checked against their bytes once fetched. */
const pdfParts = (payload: GmailPart) =>
  [...walk(payload)].filter(
    (p) =>
      p.filename &&
      (p.mimeType === "application/pdf" || p.filename.toLowerCase().endsWith(".pdf")) &&
      (p.body?.size ?? 0) <= MAX_BYTES,
  );

// ── One message ───────────────────────────────────────────────────

export type MessageOutcome = "accepted" | "rejected" | "skipped";

/** What the auto-assignment can choose between. Loaded once per sync. */
interface AssignCtx {
  units: { id: string; name: string }[];
  costCenters: { code: string; resultUnitId: string | null }[];
}

async function assignCtx(): Promise<AssignCtx> {
  const [units, centres, prefixes] = await Promise.all([
    prisma.resultUnit.findMany({ select: { id: true, name: true } }),
    prisma.costCenter.findMany({ where: { active: true }, select: { code: true } }),
    getPrefixes(),
  ]);
  return {
    units,
    costCenters: centres.map((c) => ({
      code: c.code,
      resultUnitId: resultUnitForCode(c.code, prefixes)?.resultUnitId ?? null,
    })),
  };
}

export async function processMessage(c: Config, gmailId: string, ctx: AssignCtx): Promise<MessageOutcome> {
  if (await prisma.inboundMail.findUnique({ where: { gmailId }, select: { id: true } })) return "skipped";

  const msg = await getMessage(c, gmailId);
  const top = msg.payload;
  const from = parseAddress(headerValues(top, "From")[0]);
  const reason = rejectReason(from, headerValues(top, "Authentication-Results"), c.allowedDomain);
  const subject = headerValues(top, "Subject")[0] ?? null;
  const { note, originalFrom } = splitForward(bodyText(top));
  const receivedAt = msg.internalDate ? new Date(Number(msg.internalDate)) : new Date();

  const sender = from
    ? await prisma.user.findFirst({
        where: { email: { equals: from.address, mode: "insensitive" } },
        select: { id: true, name: true, roles: true },
      })
    : null;

  // The claim. Whoever writes this row first processes the mail; the other
  // gets a unique-constraint error and leaves it.
  let mailId: string;
  try {
    const row = await prisma.inboundMail.create({
      data: {
        gmailId,
        messageId: headerValues(top, "Message-ID")[0] ?? null,
        fromAddress: from?.address ?? "",
        fromName: from?.name ?? null,
        senderId: sender?.id ?? null,
        subject,
        note,
        originalFrom,
        status: reason ? "REJECTED" : "ACCEPTED",
        rejectReason: reason,
        receivedAt,
      },
      select: { id: true },
    });
    mailId = row.id;
  } catch (err) {
    if ((err as { code?: unknown })?.code === "P2002") return "skipped";
    throw err;
  }
  if (reason) return "rejected";

  const written: string[] = [];
  try {
    // The documents first, into storage, each fetched and checked against its
    // own bytes. Something called faktura.pdf that is not one is left out.
    const docs: {
      invoiceId: string;
      documentId: string;
      key: string;
      filename: string;
      size: number;
      fields: InvoiceTextFields;
    }[] = [];
    for (const part of pdfParts(top)) {
      const bytes = part.body?.attachmentId
        ? await getAttachment(c, gmailId, part.body.attachmentId)
        : Buffer.from(part.body?.data ?? "", "base64url");
      if (bytes.length === 0 || sniffReceiptType(bytes.subarray(0, SNIFF_BYTES)) !== "application/pdf") continue;
      const invoiceId = randomUUID();
      const documentId = randomUUID();
      const key = supplierInvoiceDocumentKey(invoiceId, documentId, part.filename!);
      await putObject(key, bytes, "application/pdf");
      written.push(key);
      docs.push({
        invoiceId,
        documentId,
        key,
        filename: part.filename!,
        size: bytes.length,
        fields: await readInvoicePdf(bytes, "application/pdf"),
      });
    }

    // A mail with no PDF still becomes one invoice, to be completed by hand.
    const invoices = docs.length
      ? docs
      : [
          {
            invoiceId: randomUUID(),
            documentId: null,
            key: null,
            filename: null,
            size: 0,
            fields: {} as InvoiceTextFields,
          },
        ];

    const owned = sender ? await ownedResultUnits({ id: sender.id, roles: sender.roles }) : null;
    const forwarderUnitIds = owned
      ? ctx.units.filter((u) => owned.names.includes(u.name)).map((u) => u.id)
      : [];
    // "Er referens" counts as something the forwarder said: a supplier asked
    // to put the cost centre there has done the routing for us.
    const references = invoices.map((d) => d.fields.reference).filter(Boolean);
    const auto: AutoAssignment | null = autoAssign({
      text: [note, subject, ...references].filter(Boolean).join("\n"),
      units: ctx.units,
      costCenters: ctx.costCenters,
      forwarderUnitIds,
    });
    const unit = auto ? ctx.units.find((u) => u.id === auto.resultUnitId)! : null;
    const owners = unit
      ? (
          await prisma.user.findMany({
            where: { active: true, roles: { has: "RESULTATANSVARIG" }, resultUnits: { has: unit.name } },
            select: { id: true },
          })
        ).map((u) => u.id)
      : [];
    const description = cleanSubject(subject);

    await prisma.$transaction(async (tx) => {
      for (const d of invoices) {
        await tx.supplierInvoice.create({
          data: {
            id: d.invoiceId,
            ...prefillData({}, d.fields),
            source: "EMAIL",
            status: unit ? "ASSIGNED" : "INBOX",
            receivedById: sender?.id ?? null,
            inboundMailId: mailId,
            description,
            resultUnitId: unit?.id ?? null,
            assignedAt: unit ? new Date() : null,
            ...(d.key && {
              documents: {
                create: {
                  id: d.documentId!,
                  objectKey: d.key,
                  filename: d.filename!,
                  mimeType: "application/pdf",
                  byteSize: d.size,
                  uploadedById: sender?.id ?? null,
                },
              },
            }),
            events: {
              create: [
                { type: "RECEIVED", actorId: sender?.id ?? null },
                ...(unit && auto
                  ? [
                      {
                        type: "ASSIGNED" as const,
                        diff: { from: null, to: unit.name, auto: auto.rule, match: auto.match },
                      },
                    ]
                  : []),
              ],
            },
          },
        });
        if (unit) {
          await notify(
            tx,
            "SUPPLIER_INVOICE_ASSIGNED",
            owners,
            invoiceNotice(
              "assigned",
              {
                id: d.invoiceId,
                supplierName: null,
                invoiceNumber: null,
                description,
                amount: null,
                dueDate: null,
              },
              { actor: sender?.name ?? from!.address, unit: unit.name },
              note ? { author: sender?.name ?? from!.address, text: note } : undefined,
            ),
            { exclude: [sender?.id] },
          );
        }
      }
    });
    return "accepted";
  } catch (err) {
    // Undo the claim and whatever reached storage, so the next sync tries
    // this mail again from the start rather than finding it half done.
    for (const key of written) await deleteObjectBestEffort(key);
    await prisma.inboundMail.delete({ where: { id: mailId } }).catch(() => {});
    throw err;
  }
}

// ── The mailbox ───────────────────────────────────────────────────

const STATE = "singleton";

export interface SyncResult {
  accepted: number;
  rejected: number;
  skipped: number;
}

/**
 * Read everything that has arrived since the last sync. Null when the
 * integration is off.
 *
 * The history id only moves forward once every message up to it has been
 * handled. A mail that fails stops the sync where it is, with the error
 * recorded, and the next push or cron run tries it again.
 */
export async function syncInbox(): Promise<SyncResult | null> {
  const c = gmailConfig();
  if (!c) return null;

  const state = await prisma.gmailSync.upsert({ where: { id: STATE }, create: {}, update: {} });

  let ids: string[];
  let next: string;
  const fromScratch = async (days: number) => {
    // The current id before the listing, never after: a mail arriving between
    // the two is then read twice (and skipped the second time) rather than not
    // at all.
    next = await currentHistoryId(c);
    ids = await recentMessages(c, days);
  };
  if (!state.historyId) {
    await fromScratch(2);
  } else {
    try {
      ({ ids, historyId: next } = await messagesAddedSince(c, state.historyId));
    } catch (err) {
      // Gmail keeps about a week of history. Further back than that, the
      // week's mail is listed instead, which the unique Gmail id dedupes.
      if (!(err instanceof GmailError && err.status === 404)) throw err;
      await fromScratch(7);
    }
  }

  const result: SyncResult = { accepted: 0, rejected: 0, skipped: 0 };
  const ctx = await assignCtx();
  try {
    for (const id of ids!) result[await processMessage(c, id, ctx)]++;
  } catch (err) {
    await prisma.gmailSync.update({
      where: { id: STATE },
      data: { lastError: String((err as Error)?.message ?? err).slice(0, 500) },
    });
    throw err;
  }

  await prisma.gmailSync.update({
    where: { id: STATE },
    data: { historyId: next!, lastSyncAt: new Date(), lastError: null },
  });
  if (result.accepted) deliverSoon();
  return result;
}

/**
 * Renew Gmail's watch when it is two days from running out, or was never set.
 * Daily from the cron job, so a missed day or two costs nothing.
 */
export async function renewWatch(now = new Date()): Promise<{ renewed: boolean; expiresAt: Date | null } | null> {
  const c = gmailConfig();
  if (!c) return null;
  const state = await prisma.gmailSync.upsert({ where: { id: STATE }, create: {}, update: {} });
  const soon = new Date(now.getTime() + 2 * 24 * 3600 * 1000);
  if (state.watchExpiresAt && state.watchExpiresAt > soon) {
    return { renewed: false, expiresAt: state.watchExpiresAt };
  }
  const w = await watch(c);
  await prisma.gmailSync.update({
    where: { id: STATE },
    // The first watch also says where reading starts, so mail that was in the
    // mailbox before the integration was switched on is not swept in.
    data: { watchExpiresAt: w.expiration, ...(state.historyId ? {} : { historyId: w.historyId }) },
  });
  return { renewed: true, expiresAt: w.expiration };
}
