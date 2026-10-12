-- The outbox as a log: who sent a test mail by hand, and indexes for reading
-- one member's mail and the whole log newest first.

-- AlterTable
ALTER TABLE "OutboundEmail" ADD COLUMN     "sentById" TEXT;

-- CreateIndex
CREATE INDEX "OutboundEmail_recipientId_createdAt_idx" ON "OutboundEmail"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundEmail_createdAt_idx" ON "OutboundEmail"("createdAt");

-- AddForeignKey
ALTER TABLE "OutboundEmail" ADD CONSTRAINT "OutboundEmail_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
