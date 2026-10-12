// The outbox read as a log: every mail the app has written, to whom, and what
// became of it. See prisma/schema/notification.prisma.
//
// Read by Inställningar → E-post, which lists all of it, and by the person
// dialog under Användare, which lists one member's. "Visa fler" asks for a
// longer list rather than the next page, so a reload after a retry or a test
// mail redraws everything on screen, not just its first page.
import "server-only";

import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { mailEnabled } from "@/lib/server/mail";
import { MAX_ATTEMPTS } from "@/lib/server/notify";
import { LOGO_CID } from "@/lib/email/types";
import type { NotificationKind } from "@/lib/domain/types";

/**
 * Where a mail has got to.
 *
 *   SENT      the relay took it
 *   QUEUED    not tried yet, or tried and not finished (a lease still held)
 *   RETRYING  failed, and will be tried again
 *   FAILED    failed every try it gets, and stays unsent until retried by hand
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
  /** Whether the log goes on past these rows. */
  more: boolean;
  /** Whether a relay is set. Off, every mail is "sent" to the server log. */
  mailEnabled: boolean;
}

/** How many rows a list starts with, and how many more each "Visa fler" adds. */
export const EMAIL_LOG_PAGE = 50;
const MAX_TAKE = 1000;

function status(r: { sentAt: Date | null; lastError: string | null; attempts: number }): EmailStatus {
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
  /** Matched against the subject and the recipient's name and address. */
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
    // One more than asked for, to learn whether the log goes on.
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

/** One mail as it was written: both bodies, ready to show. */
export async function getEmailBody(
  id: string,
): Promise<{ subject: string; text: string; html: string | null } | null> {
  const row = await prisma.outboundEmail.findUnique({
    where: { id },
    select: { subject: true, text: true, html: true },
  });
  if (!row) return null;
  // The logo is an attachment in a sent mail, drawn by content id. A browser
  // has no attachment to resolve that against, so the preview points it at
  // the same file in public/ instead.
  const html = row.html?.replaceAll(`cid:${LOGO_CID}`, "/email-logo.png") ?? null;
  return { ...row, html };
}
