// Turning mail in the levfaktura inkorg mailbox into Inkorg documents, and the stored login that reads it.
// Run by the Pub/Sub push (api/inbound/gmail) and the cron job (api/cron/gmail-sync). Safe to run twice at once: each mail is
// claimed by writing its InboundMail row first (unique Gmail id).
// Outside dsek.se or unverified, or no PDF: REJECTED with a reason. One PDF with a note that settles whose
// it is (autoAssign in lib/domain/inbound-mail.ts): straight into that unit's Inkorg. Otherwise the PDFs
// go to the Inkorg for triage.
import "server-only";

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/server/db";
import { deleteObjectBestEffort, putObject, supplierInvoiceInboxKey } from "@/lib/server/storage";
import { getPrefixes, ownedResultUnits, resultUnitForCode } from "@/lib/server/result-units";
import { deliverSoon, notify } from "@/lib/server/notify";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { documentNotice } from "@/lib/email/content";
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
  getAttachment,
  getMessage,
  gmailConfig,
  messagesAddedSince,
  profile,
  recentMessages,
  revoke,
  stopWatch,
  watch,
  type GmailMailbox,
  type GmailPart,
} from "./gmail";

// The same ceiling a hand upload has (lib/server/document-upload.ts).
const MAX_BYTES = 25 * 1024 * 1024;

const headerValues = (part: GmailPart, name: string): string[] =>
  (part.headers ?? [])
    .filter((h) => h.name.toLowerCase() === name.toLowerCase())
    .map((h) => h.value);

function* walk(part: GmailPart): Generator<GmailPart> {
  yield part;
  for (const p of part.parts ?? []) yield* walk(p);
}

const decode = (data: string | undefined) =>
  data ? Buffer.from(data, "base64url").toString("utf8") : "";

/** The mail's text: its first text/plain part, or its HTML with the tags removed. */
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

/** The PDFs attached, by what they say they are (checked against their bytes once fetched). */
const pdfParts = (payload: GmailPart) =>
  [...walk(payload)].filter(
    (p) =>
      p.filename &&
      (p.mimeType === "application/pdf" || p.filename.toLowerCase().endsWith(".pdf")) &&
      (p.body?.size ?? 0) <= MAX_BYTES,
  );

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

async function processMessage(
  c: GmailMailbox,
  gmailId: string,
  ctx: AssignCtx,
): Promise<MessageOutcome> {
  if (await prisma.inboundMail.findUnique({ where: { gmailId }, select: { id: true } }))
    return "skipped";

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

  // The claim: whoever writes this row first processes the mail.
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
    // Documents first, each checked against its own bytes. A faktura.pdf that is not a PDF is left out.
    const docs: { documentId: string; key: string; filename: string; size: number }[] = [];
    for (const part of pdfParts(top)) {
      const bytes = part.body?.attachmentId
        ? await getAttachment(c, gmailId, part.body.attachmentId)
        : Buffer.from(part.body?.data ?? "", "base64url");
      if (
        bytes.length === 0 ||
        sniffReceiptType(bytes.subarray(0, SNIFF_BYTES)) !== "application/pdf"
      )
        continue;
      const documentId = randomUUID();
      const key = supplierInvoiceInboxKey(documentId, part.filename!);
      await putObject(key, bytes, "application/pdf");
      written.push(key);
      docs.push({
        documentId,
        key,
        filename: part.filename!,
        size: bytes.length,
      });
    }

    const owned = sender ? await ownedResultUnits({ id: sender.id, roles: sender.roles }) : null;
    const forwarderUnitIds = owned
      ? ctx.units.filter((u) => owned.names.includes(u.name)).map((u) => u.id)
      : [];
    // Only what the forwarder wrote routes it. The PDF is not read until its unit fördelar it.
    const auto: AutoAssignment | null = autoAssign({
      text: [note, subject].filter(Boolean).join("\n"),
      units: ctx.units,
      costCenters: ctx.costCenters,
      forwarderUnitIds,
    });
    const unit = auto ? ctx.units.find((u) => u.id === auto.resultUnitId)! : null;
    const documentRow = (d: (typeof docs)[number]) => ({
      id: d.documentId,
      objectKey: d.key,
      filename: d.filename,
      mimeType: "application/pdf",
      byteSize: d.size,
      uploadedById: sender?.id ?? null,
      inboundMailId: mailId,
    });

    if (docs.length === 0) {
      await prisma.inboundMail.update({
        where: { id: mailId },
        data: { status: "REJECTED", rejectReason: "noPdf" },
      });
      return "rejected";
    }
    if (docs.length > 1 || !unit) {
      await prisma.supplierInvoiceDocument.createMany({ data: docs.map(documentRow) });
      return "accepted";
    }

    const [only] = docs;
    const owners = (
      await prisma.user.findMany({
        where: {
          active: true,
          roles: { has: "RESULTATANSVARIG" },
          resultUnits: { has: unit.name },
        },
        select: { id: true },
      })
    ).map((u) => u.id);

    await prisma.$transaction(async (tx) => {
      await tx.supplierInvoiceDocument.create({
        data: { ...documentRow(only), resultUnitId: unit.id, assignedAt: new Date() },
      });
      await notify(
        tx,
        "SUPPLIER_INVOICE_ASSIGNED",
        owners,
        documentNotice(
          { id: only.documentId, title: cleanSubject(subject) },
          { actor: sender?.name ?? from!.address, unit: unit.name },
          note ? { author: sender?.name ?? from!.address, text: note } : undefined,
        ),
        { exclude: [sender?.id] },
      );
    });
    return "accepted";
  } catch (err) {
    // Undo the claim and whatever reached storage, so the next sync retries the mail from the start.
    for (const key of written) await deleteObjectBestEffort(key);
    await prisma.inboundMail.delete({ where: { id: mailId } }).catch(() => {});
    throw err;
  }
}

const STATE = "singleton";

const syncState = () => prisma.gmailSync.upsert({ where: { id: STATE }, create: {}, update: {} });

/** The configuration with the stored login. Null when the integration is off or the mailbox is not connected. */
async function connectedMailbox(): Promise<GmailMailbox | null> {
  const c = gmailConfig();
  if (!c) return null;
  const state = await prisma.gmailSync.findUnique({
    where: { id: STATE },
    select: { refreshToken: true },
  });
  return state?.refreshToken ? { ...c, refreshToken: decryptSecret(state.refreshToken) } : null;
}

/** Run a Gmail job, forgetting the login when Google no longer accepts it so the Inkorg asks for a reconnect. */
async function withMailbox<T>(job: (m: GmailMailbox) => Promise<T>): Promise<T | null> {
  const m = await connectedMailbox();
  if (!m) return null;
  try {
    return await job(m);
  } catch (err) {
    const message = String((err as Error)?.message ?? err).slice(0, 500);
    await prisma.gmailSync.update({
      where: { id: STATE },
      data:
        err instanceof GmailError && err.revoked
          ? { refreshToken: null, watchExpiresAt: null, lastError: message }
          : { lastError: message },
    });
    throw err;
  }
}

export interface SyncResult {
  accepted: number;
  rejected: number;
  skipped: number;
}

/**
 * Read everything that has arrived since the last sync. Null when the integration is off or the mailbox is
 * not connected. The history id only moves forward once every message up to it is handled; a failing mail
 * stops the sync there.
 */
export function syncInbox(): Promise<SyncResult | null> {
  return withMailbox(async (c) => {
    const state = await syncState();

    let ids: string[];
    let next: string;
    const fromScratch = async (days: number) => {
      // The current id before the listing, so a mail arriving between is read twice rather than not at all.
      next = (await profile(c)).historyId;
      ids = await recentMessages(c, days);
    };
    if (!state.historyId) {
      await fromScratch(2);
    } else {
      try {
        ({ ids, historyId: next } = await messagesAddedSince(c, state.historyId));
      } catch (err) {
        // Gmail keeps about a week of history; further back the week's mail is listed (deduped by Gmail id).
        if (!(err instanceof GmailError && err.status === 404)) throw err;
        await fromScratch(7);
      }
    }

    const result: SyncResult = { accepted: 0, rejected: 0, skipped: 0 };
    const ctx = await assignCtx();
    for (const id of ids!) result[await processMessage(c, id, ctx)]++;

    await prisma.gmailSync.update({
      where: { id: STATE },
      data: { historyId: next!, lastSyncAt: new Date(), lastError: null },
    });
    if (result.accepted) deliverSoon();
    return result;
  });
}

/**
 * Renew Gmail's watch when it is two days from running out, or was never set. Null when the integration is
 * off or the mailbox is not connected.
 */
export function renewWatch(
  now = new Date(),
): Promise<{ renewed: boolean; expiresAt: Date | null } | null> {
  return withMailbox(async (c) => {
    const state = await syncState();
    const soon = new Date(now.getTime() + 2 * 24 * 3600 * 1000);
    if (state.watchExpiresAt && state.watchExpiresAt > soon) {
      return { renewed: false, expiresAt: state.watchExpiresAt };
    }
    const w = await watch(c);
    await prisma.gmailSync.update({
      where: { id: STATE },
      // The first watch also says where reading starts, so older mail is not swept in.
      data: {
        watchExpiresAt: w.expiration,
        ...(state.historyId ? {} : { historyId: w.historyId }),
      },
    });
    return { renewed: true, expiresAt: w.expiration };
  });
}

/**
 * Store a fresh login for the mailbox and start the watch. Where reading had got to is kept, so mail that
 * arrived while the mailbox was disconnected is still read (as far back as Gmail keeps history).
 */
export async function connectMailbox(refreshToken: string, userId: string): Promise<void> {
  const c = gmailConfig();
  if (!c) throw new Error("Gmail is not configured");
  await syncState();
  await prisma.gmailSync.update({
    where: { id: STATE },
    data: {
      refreshToken: encryptSecret(refreshToken),
      connectedAddress: c.mailbox,
      connectedById: userId,
      connectedAt: new Date(),
      watchExpiresAt: null,
      lastError: null,
    },
  });
  await renewWatch();
}

/** Stop the watch, withdraw the login at Google and forget it. */
export async function disconnectMailbox(): Promise<void> {
  const m = await connectedMailbox();
  if (m) {
    await stopWatch(m).catch(() => {});
    await revoke(m.refreshToken);
  }
  await prisma.gmailSync.updateMany({
    where: { id: STATE },
    data: { refreshToken: null, watchExpiresAt: null },
  });
}
