-- E-mail notifications: per-member preferences and the outbox mail is sent from.
--
-- Preferences store only departures from the defaults in
-- lib/domain/notifications.ts, so nothing needs backfilling here.

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('EXPENSE_SUBMITTED', 'EXPENSE_CHANGES_REQUESTED', 'EXPENSE_DEADLINE_WAIVER_REVOKED', 'CARD_TRANSACTIONS_IMPORTED', 'EXPENSE_COST_CENTER_APPROVED', 'EXPENSE_APPROVED', 'EXPENSE_READY_TO_BOOK', 'EXPENSE_ATTEST_WITHDRAWN', 'EXPENSE_RECALLED', 'EXPENSE_EXPORTED', 'EXPENSE_EXPORT_REVERTED', 'EXPENSE_DEADLINE_WAIVED', 'WEEKLY_DIGEST');

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId","kind")
);

-- CreateTable
CREATE TABLE "OutboundEmail" (
    "id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "recipientId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "OutboundEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundEmail_dedupeKey_key" ON "OutboundEmail"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboundEmail_sentAt_createdAt_idx" ON "OutboundEmail"("sentAt", "createdAt");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
