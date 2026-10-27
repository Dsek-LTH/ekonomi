-- Levfakturor by mail: what the app decided about each mail forwarded to the
-- inkorg mailbox, and where it has read Gmail up to. See
-- prisma/schema/inbound-mail.prisma.

-- CreateEnum
CREATE TYPE "InboundMailStatus" AS ENUM ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "inboundMailId" TEXT;

-- CreateTable
CREATE TABLE "InboundMail" (
    "id" TEXT NOT NULL,
    "gmailId" TEXT NOT NULL,
    "messageId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "fromName" TEXT,
    "senderId" TEXT,
    "subject" TEXT,
    "note" TEXT,
    "originalFrom" TEXT,
    "status" "InboundMailStatus" NOT NULL,
    "rejectReason" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GmailSync" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "historyId" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundMail_gmailId_key" ON "InboundMail"("gmailId");

-- CreateIndex
CREATE INDEX "InboundMail_status_createdAt_idx" ON "InboundMail"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InboundMail_originalFrom_idx" ON "InboundMail"("originalFrom");

-- CreateIndex
CREATE INDEX "SupplierInvoice_inboundMailId_idx" ON "SupplierInvoice"("inboundMailId");

-- AddForeignKey
ALTER TABLE "InboundMail" ADD CONSTRAINT "InboundMail_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_inboundMailId_fkey" FOREIGN KEY ("inboundMailId") REFERENCES "InboundMail"("id") ON DELETE SET NULL ON UPDATE CASCADE;

