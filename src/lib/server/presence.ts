// Who has an utlägg's booking screen or review open, in Postgres (the app may run as several pods). All
// timestamps are the database's now(), UTC, so pod clock skew does not matter. Present means a heartbeat
// within the TTL; the prune only keeps the table small. See lib/domain/presence.ts.
import "server-only";

import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/server/db";
import { PRESENCE_TTL_MS, type PresenceScreen, type PresentUser } from "@/lib/domain/presence";

const NOW = Prisma.sql`(now() AT TIME ZONE 'UTC')`;
// Constants, not input, so they can be spliced into the SQL.
const TTL = Prisma.raw(`interval '${PRESENCE_TTL_MS / 1000} seconds'`);
const PRUNE_AFTER = Prisma.raw(`interval '10 minutes'`);

const SCREEN: Record<PresenceScreen, Prisma.Sql> = {
  book: Prisma.sql`'BOOK'::"PresenceScreen"`,
  review: Prisma.sql`'REVIEW'::"PresenceScreen"`,
};

/** Record that `userId` is on `screen` of `expenseId`, or that they have gone idle. The expense must exist. */
export async function heartbeat(
  expenseId: string,
  userId: string,
  screen: PresenceScreen,
  active: boolean,
) {
  if (active) {
    await prisma.$executeRaw`
      INSERT INTO "ExpensePresence" ("expenseId", "userId", "screen", "lastSeenAt")
      VALUES (${expenseId}, ${userId}, ${SCREEN[screen]}, ${NOW})
      ON CONFLICT ("expenseId", "userId", "screen")
      DO UPDATE SET "lastSeenAt" = EXCLUDED."lastSeenAt"`;
  } else {
    await leave(expenseId, userId, screen);
  }
  // Housekeeping, piggybacked on a frequent request.
  await prisma.$executeRaw`
    DELETE FROM "ExpensePresence" WHERE "lastSeenAt" < ${NOW} - ${PRUNE_AFTER}`;
}

/** Leave `screen` of `expenseId`. Nothing to do when not on it. */
export async function leave(expenseId: string, userId: string, screen: PresenceScreen) {
  await prisma.$executeRaw`
    DELETE FROM "ExpensePresence"
    WHERE "expenseId" = ${expenseId} AND "userId" = ${userId} AND "screen" = ${SCREEN[screen]}`;
}

/** Everybody but `selfId` on `screen` of `expenseId`. */
export function othersOn(
  expenseId: string,
  selfId: string,
  screen: PresenceScreen,
): Promise<PresentUser[]> {
  return prisma.$queryRaw<PresentUser[]>`
    SELECT u."id", u."name"
    FROM "ExpensePresence" p JOIN "User" u ON u."id" = p."userId"
    WHERE p."expenseId" = ${expenseId}
      AND p."screen" = ${SCREEN[screen]}
      AND p."userId" <> ${selfId}
      AND p."lastSeenAt" > ${NOW} - ${TTL}
    ORDER BY u."name"`;
}

/** Every utlägg somebody other than `selfId` is booking or reviewing now, with who, one map per screen. */
export async function activePresence(
  selfId: string,
): Promise<Record<PresenceScreen, Record<string, PresentUser[]>>> {
  const rows = await prisma.$queryRaw<
    (PresentUser & { expenseId: string; screen: "BOOK" | "REVIEW" })[]
  >`
    SELECT p."expenseId", p."screen", u."id", u."name"
    FROM "ExpensePresence" p JOIN "User" u ON u."id" = p."userId"
    WHERE p."userId" <> ${selfId}
      AND p."lastSeenAt" > ${NOW} - ${TTL}
    ORDER BY u."name"`;
  const out: Record<PresenceScreen, Record<string, PresentUser[]>> = { book: {}, review: {} };
  for (const { expenseId, screen, id, name } of rows) {
    const byExpense = screen === "REVIEW" ? out.review : out.book;
    (byExpense[expenseId] ??= []).push({ id, name });
  }
  return out;
}
