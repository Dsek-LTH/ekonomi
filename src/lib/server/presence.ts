// Who has an utlägg's booking screen open, kept in Postgres.
//
// In Postgres rather than in memory because the app may run as more than one
// pod, and a bookkeeper on one pod has to see a colleague on another.
//
// Every timestamp here is the database's: written as now(), compared against
// now(). Pods whose clocks disagree by a few seconds would otherwise make a
// heartbeat look older or newer than it is, and with a 30 second window a few
// seconds is a real share of it. Stored as UTC, the same as every DateTime
// Prisma writes, so the column reads back correctly through the client too.
//
// Being present is "a heartbeat within the TTL", decided when somebody asks. A
// row nobody deleted (a crash, a dropped network) is not present, and nothing
// has to clean it up for that to be true. The prune below only keeps the table
// small. See lib/domain/presence.ts for why none of this is a lock.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { PRESENCE_TTL_MS, type PresentUser } from "@/lib/domain/presence";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
// Constants, not input, so they can be spliced into the SQL as literals.
const TTL = Prisma.raw(`interval '${PRESENCE_TTL_MS / 1000} seconds'`);
const PRUNE_AFTER = Prisma.raw(`interval '10 minutes'`);

/**
 * Record that `userId` is on the booking screen of `expenseId`, or, when they
 * have gone idle, that they no longer are.
 *
 * The expense must exist. The caller has just read it.
 */
export async function heartbeat(expenseId: string, userId: string, active: boolean) {
  if (active) {
    await prisma.$executeRaw`
      INSERT INTO "ExpensePresence" ("expenseId", "userId", "lastSeenAt")
      VALUES (${expenseId}, ${userId}, ${NOW})
      ON CONFLICT ("expenseId", "userId") DO UPDATE SET "lastSeenAt" = EXCLUDED."lastSeenAt"`;
  } else {
    await leave(expenseId, userId);
  }
  // Housekeeping, piggybacked on a request that happens every few seconds
  // anyway. Indexed, and almost always deletes nothing.
  await prisma.$executeRaw`
    DELETE FROM "ExpensePresence" WHERE "lastSeenAt" < ${NOW} - ${PRUNE_AFTER}`;
}

/** Leave the booking screen of `expenseId`. Nothing to do when not on it. */
export async function leave(expenseId: string, userId: string) {
  await prisma.$executeRaw`
    DELETE FROM "ExpensePresence" WHERE "expenseId" = ${expenseId} AND "userId" = ${userId}`;
}

/** Everybody but `selfId` on the booking screen of `expenseId`. */
export function othersOn(expenseId: string, selfId: string): Promise<PresentUser[]> {
  return prisma.$queryRaw<PresentUser[]>`
    SELECT u."id", u."name"
    FROM "ExpensePresence" p JOIN "User" u ON u."id" = p."userId"
    WHERE p."expenseId" = ${expenseId}
      AND p."userId" <> ${selfId}
      AND p."lastSeenAt" > ${NOW} - ${TTL}
    ORDER BY u."name"`;
}

/**
 * Every utlägg somebody other than `selfId` is booking right now, with who.
 *
 * All of them rather than a page's worth: a handful of bookkeepers can only
 * have a handful of screens open, so this is a few rows, and the list does not
 * have to send the ids it is showing.
 */
export async function activeBookings(selfId: string): Promise<Record<string, PresentUser[]>> {
  const rows = await prisma.$queryRaw<(PresentUser & { expenseId: string })[]>`
    SELECT p."expenseId", u."id", u."name"
    FROM "ExpensePresence" p JOIN "User" u ON u."id" = p."userId"
    WHERE p."userId" <> ${selfId}
      AND p."lastSeenAt" > ${NOW} - ${TTL}
    ORDER BY u."name"`;
  const byExpense: Record<string, PresentUser[]> = {};
  for (const { expenseId, id, name } of rows) {
    (byExpense[expenseId] ??= []).push({ id, name });
  }
  return byExpense;
}
