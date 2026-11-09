import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { mailEnabled } from "@/lib/server/mail";
import { MAX_ATTEMPTS } from "@/lib/server/notify";
import { LOGO_CID } from "@/lib/email/types";
import type { NotificationKind } from "@/lib/domain/types";

/**
 * SENT: relay took it. QUEUED: not tried yet, or lease held. RETRYING: failed, will retry.
 * FAILED: exhausted its tries, unsent until retried by hand.
 */
export type EmailStatus = "SENT" | "QUEUED" | "RETRYING" | "FAILED";

/** Which slice of the log to show. "" is all of it. */
export type EmailFilter = "" | "sent" | "unsent" | "failed";

export interface EmailLogRow {
  id: string;
  kind: NotificationKind;
  subject: string;
  recipient: { id: string; name: string; email: string };
  /** Who sent it by hand, for a test mail. Null for everything else. */
  sentBy: string | null;
  createdAt: string;
  sentAt: string | null;
  attempts: number;
  lastError: string | null;
  status: EmailStatus;
}

export interface EmailLogPage {
  rows: EmailLogRow[];
  more: boolean;
  /** Whether a relay is set. Off, every mail is "sent" to the server log. */
  mailEnabled: boolean;
}

/** How many rows a list starts with, and how many more each "Visa fler" adds. */
const EMAIL_LOG_PAGE = 50;
const MAX_TAKE = 1000;

function status(r: {
  sentAt: Date | null;
  lastError: string | null;
  attempts: number;
}): EmailStatus {
  if (r.sentAt) return "SENT";
  if (r.attempts >= MAX_ATTEMPTS) return "FAILED";
  return r.lastError ? "RETRYING" : "QUEUED";
}

const FILTERS: Record<Exclude<EmailFilter, "">, Prisma.OutboundEmailWhereInput> = {
  sent: { sentAt: { not: null } },
  unsent: { sentAt: null },
  failed: { sentAt: null, lastError: { not: null } },
};

export async function getEmailLog(opts: {
  recipientId?: string;
  filter?: EmailFilter;
  q?: string;
  /** How many rows. Clamped to a page at the least. */
  take?: number;
}): Promise<EmailLogPage> {
  const take = Math.min(Math.max(opts.take ?? EMAIL_LOG_PAGE, EMAIL_LOG_PAGE), MAX_TAKE);
  const and: Prisma.OutboundEmailWhereInput[] = [];
  if (opts.recipientId) and.push({ recipientId: opts.recipientId });
  if (opts.filter) and.push(FILTERS[opts.filter]);
  if (opts.q) {
    and.push({
      OR: [
        { subject: { contains: opts.q, mode: "insensitive" } },
        { recipient: { name: { contains: opts.q, mode: "insensitive" } } },
        { recipient: { email: { contains: opts.q, mode: "insensitive" } } },
      ],
    });
  }

  const rows = await prisma.outboundEmail.findMany({
    where: { AND: and },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      kind: true,
      subject: true,
      createdAt: true,
      sentAt: true,
      attempts: true,
      lastError: true,
      recipient: { select: { id: true, name: true, email: true } },
      sentBy: { select: { name: true } },
    },
  });

  return {
    rows: rows.slice(0, take).map((r) => ({
      id: r.id,
      kind: r.kind,
      subject: r.subject,
      recipient: r.recipient,
      sentBy: r.sentBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      attempts: r.attempts,
      lastError: r.lastError,
      status: status(r),
    })),
    more: rows.length > take,
    mailEnabled: mailEnabled(),
  };
}

export async function getEmailBody(
  id: string,
): Promise<{ subject: string; text: string; html: string | null } | null> {
  const row = await prisma.outboundEmail.findUnique({
    where: { id },
    select: { subject: true, text: true, html: true },
  });
  if (!row) return null;
  // The logo is a content-id attachment in a sent mail; the preview points at public/ instead.
  const html = row.html?.replaceAll(`cid:${LOGO_CID}`, "/email-logo.png") ?? null;
  return { ...row, html };
}
