// Telling people by email. `notify()` writes to the outbox inside the change's transaction (so a lost race
// mails nobody), `deliverSoon()` sends after the response, `deliverPending()` is the sender (also run by
// the cron sweep, which retries a down relay). The person who did the thing is never mailed.
import "server-only";

import { after } from "next/server";
import { prisma } from "@/lib/server/db";
import { roleCapabilities } from "@/lib/server/capabilities";
import { getPrefixes, resultUnitNameForCode } from "@/lib/server/result-units";
import { sendMail } from "@/lib/server/mail";
import type { TxClient } from "@/lib/server/tx";
import { wants } from "@/lib/domain/notifications";
import type { Capability, NotificationKind, Role } from "@/lib/domain/types";
import { renderHtml, renderText, type Email } from "@/lib/email/render";

/**
 * Write `email` to the outbox for each recipient who wants `kind`, skipping inactive members and `exclude`
 * (the actor). Pass a function to write each recipient their own. `dedupeKey` makes the mail at-most-once
 * per key (keeps the weekly digest to one per week).
 */
export async function notify(
  tx: TxClient,
  kind: NotificationKind,
  recipientIds: Iterable<string>,
  email: Email | ((recipient: { id: string; name: string }) => Email),
  opts: {
    exclude?: Iterable<string | null | undefined>;
    dedupeKey?: (id: string) => string;
  } = {},
): Promise<number> {
  const excluded = new Set(opts.exclude ?? []);
  const ids = [...new Set(recipientIds)].filter((id) => !excluded.has(id));
  if (ids.length === 0) return 0;

  const people = await tx.user.findMany({
    where: { id: { in: ids }, active: true },
    select: {
      id: true,
      name: true,
      notificationPrefs: { where: { kind }, select: { kind: true, enabled: true } },
    },
  });
  // Rendering touches no database, so it is safe inside the transaction.
  const rows = await Promise.all(
    people
      .filter((p) => wants(kind, new Map(p.notificationPrefs.map((n) => [n.kind, n.enabled]))))
      .map(async (p) => {
        const e = typeof email === "function" ? email(p) : email;
        return {
          kind,
          recipientId: p.id,
          subject: e.subject,
          text: renderText(e),
          html: await renderHtml(e),
          dedupeKey: opts.dedupeKey?.(p.id) ?? null,
        };
      }),
  );
  if (rows.length === 0) return 0;
  const { count } = await tx.outboundEmail.createMany({ data: rows, skipDuplicates: true });
  return count;
}

/** Put a mail that stopped being retried back in the queue. Its last error stays. False when there is nothing to retry. */
export async function retryEmail(id: string): Promise<boolean> {
  const { count } = await prisma.outboundEmail.updateMany({
    where: { id, sentAt: null },
    data: { attempts: 0, claimedAt: null },
  });
  return count > 0;
}

/** The roles that currently hold `cap`, from the editable matrix. */
async function rolesWith(cap: Capability): Promise<Role[]> {
  const matrix = await roleCapabilities();
  return [...matrix].filter(([, caps]) => caps.includes(cap)).map(([role]) => role);
}

/** Every active member holding `cap` through one of their roles. */
export async function holdersOf(cap: Capability): Promise<string[]> {
  const roles = await rolesWith(cap);
  if (roles.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { active: true, roles: { hasSome: roles } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/**
 * Who should be asked to attest these allocations: the resultatansvarig for each result unit. Admins only
 * for an allocation nobody else can attest (no resultatansvarig, cost centre outside every unit, or the
 * submitter is the only owner). The digest uses the same answer.
 */
export async function attestersOf(
  allocations: readonly { costCenterCode: string }[],
  submitterId: string,
): Promise<string[]> {
  const prefixes = await getPrefixes();
  const units = allocations.map((a) => resultUnitNameForCode(a.costCenterCode, prefixes));
  const named = [...new Set(units.filter((u): u is string => u !== null))];

  const owners = named.length
    ? await prisma.user.findMany({
        where: {
          active: true,
          id: { not: submitterId },
          roles: { has: "RESULTATANSVARIG" },
          resultUnits: { hasSome: named },
        },
        select: { id: true, resultUnits: true },
      })
    : [];

  const ids = new Set<string>();
  let orphaned = false;
  for (const unit of units) {
    const forUnit = unit === null ? [] : owners.filter((o) => o.resultUnits.includes(unit));
    if (forUnit.length === 0) orphaned = true;
    for (const o of forUnit) ids.add(o.id);
  }
  if (orphaned) {
    for (const id of await holdersOf("ADMIN")) if (id !== submitterId) ids.add(id);
  }
  return [...ids];
}

// A sender holds a row this long before another may take it over, and it is the least time between tries.
const LEASE_MS = 5 * 60_000;
// Enough tries to ride out an afternoon's outage with the cron sweep every quarter hour.
export const MAX_ATTEMPTS = 12;
const BATCH = 100;

/** Send what is waiting in the outbox. Safe to run any number of times at once. */
export async function deliverPending(): Promise<{ sent: number; failed: number }> {
  const stale = new Date(Date.now() - LEASE_MS);
  const rows = await prisma.outboundEmail.findMany({
    where: {
      sentAt: null,
      attempts: { lt: MAX_ATTEMPTS },
      OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }],
    },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    include: { recipient: { select: { email: true } } },
  });

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // The lease: only the sender whose write matched the claim it read may send.
    const { count } = await prisma.outboundEmail.updateMany({
      where: { id: row.id, sentAt: null, claimedAt: row.claimedAt },
      data: { claimedAt: new Date(), attempts: { increment: 1 } },
    });
    if (count === 0) continue;

    try {
      await sendMail({
        to: row.recipient.email,
        subject: row.subject,
        text: row.text,
        html: row.html,
      });
      await prisma.outboundEmail.update({
        where: { id: row.id },
        data: { sentAt: new Date(), lastError: null },
      });
      sent++;
    } catch (err) {
      // The claim is left in place, so the next try waits out the lease.
      await prisma.outboundEmail.update({
        where: { id: row.id },
        data: { lastError: err instanceof Error ? err.message : String(err) },
      });
      failed++;
    }
  }
  return { sent, failed };
}

/**
 * Send the outbox once this response is out. Called by a route after a commit
 * that may have written to it; a sender with nothing to send costs one query.
 */
export function deliverSoon(): void {
  after(() => deliverPending().catch((err) => console.error("[mail] utskicket misslyckades", err)));
}
