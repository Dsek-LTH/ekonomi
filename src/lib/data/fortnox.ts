// What the app can say about Fortnox without exposing a secret: whether the
// organisation is connected, and whether the viewer has a live login of their
// own to book under.
import "server-only";

import { prisma } from "@/lib/server/db";
import { fortnoxConfigured } from "@/lib/fortnox";
import type { FortnoxStatus } from "@/lib/domain/types";

// A user's live personal Fortnox session, or null when they have none (or it
// has run past its cap). Just the session, for /profile, which has no use for
// the org's service connection.
export async function getFortnoxSession(
  userId: string,
): Promise<FortnoxStatus["session"] | null> {
  const session = await prisma.fortnoxUserSession.findUnique({ where: { userId } });
  if (!session || session.sessionExpiresAt.getTime() <= Date.now()) return null;
  return {
    fortnoxUserName: session.fortnoxUserName ?? undefined,
    expiresAt: session.sessionExpiresAt.toISOString(),
  };
}

// The Fortnox company the section is connected to, for the header. Personal
// logins are refused for any other company (api/fortnox/callback), so this is
// also the company a bookkeeper's export lands in.
export async function getFortnoxCompany(): Promise<string | null> {
  const conn = await prisma.fortnoxConnection.findFirst({
    orderBy: { createdAt: "desc" },
    select: { companyName: true },
  });
  return conn?.companyName ?? null;
}

// The org's Fortnox connection status, plus the viewer's own bookkeeping
// session when they have one (no secrets, safe for the client).
export async function getFortnoxStatus(userId?: string): Promise<FortnoxStatus> {
  const [conn, session] = await Promise.all([
    prisma.fortnoxConnection.findFirst({ orderBy: { createdAt: "desc" } }),
    userId ? prisma.fortnoxUserSession.findUnique({ where: { userId } }) : null,
  ]);
  const live = session && session.sessionExpiresAt.getTime() > Date.now() ? session : null;
  return {
    configured: fortnoxConfigured(),
    connected: Boolean(conn),
    companyName: conn?.companyName ?? undefined,
    voucherSeries: conn?.voucherSeries ?? undefined,
    refreshFailed: conn?.refreshFailedAt
      ? { at: conn.refreshFailedAt.toISOString(), error: conn.refreshError ?? "" }
      : undefined,
    session: live
      ? {
          fortnoxUserName: live.fortnoxUserName ?? undefined,
          expiresAt: live.sessionExpiresAt.toISOString(),
        }
      : undefined,
  };
}

/** The kept supplier register: how many, and when it was last read. */
export async function getSupplierSyncStatus(): Promise<{ count: number; lastSyncAt: string | null }> {
  const agg = await prisma.supplier.aggregate({ _count: true, _max: { syncedAt: true } });
  return { count: agg._count, lastSyncAt: agg._max.syncedAt?.toISOString() ?? null };
}

/** The last full sync (the nightly job's, or one started by hand). */
export interface FortnoxSyncStatus {
  runningSince: string | null;
  lastFinishedAt: string | null;
  lastError: string | null;
}

export async function getFortnoxSyncStatus(): Promise<FortnoxSyncStatus> {
  const row = await prisma.fortnoxSync.findUnique({ where: { id: "singleton" } });
  return {
    runningSince: row?.runningSince?.toISOString() ?? null,
    lastFinishedAt: row?.lastFinishedAt?.toISOString() ?? null,
    lastError: row?.lastError ?? null,
  };
}
