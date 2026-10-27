-- Bokslut: the checklist and its template, and the record of which balance
-- accounts have been reconciled in Fortnox. See prisma/schema/closing.prisma.

-- CreateEnum
CREATE TYPE "ClosingCheck" AS ENUM ('EXPENSES_EXPORTED', 'CARD_PURCHASES_ACCOUNTED', 'INCOME_EXPORTED', 'LEDGER_SYNCED', 'STOCKTAKE_AT_YEAR_END', 'BALANCES_RECONCILED', 'TREASURY_REVIEWED', 'AUDITORS_REVIEWED');

-- CreateTable
CREATE TABLE "ChecklistTemplateItem" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "howTo" TEXT NOT NULL DEFAULT '',
    "ownerRole" "Role",
    "dueOffsetDays" INTEGER,
    "check" "ClosingCheck",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "financialYear" INTEGER NOT NULL,
    "templateId" TEXT,
    "title" TEXT NOT NULL,
    "howTo" TEXT NOT NULL DEFAULT '',
    "ownerRole" "Role",
    "dueDate" DATE,
    "check" "ClosingCheck",
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "noteToNextYear" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountReconciliation" (
    "financialYear" INTEGER NOT NULL,
    "account" TEXT NOT NULL,
    "reconciledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reconciledById" TEXT,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "AccountReconciliation_pkey" PRIMARY KEY ("financialYear","account")
);

-- CreateTable
CREATE TABLE "AccountNote" (
    "account" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountNote_pkey" PRIMARY KEY ("account")
);

-- CreateIndex
CREATE INDEX "ChecklistItem_financialYear_sortOrder_idx" ON "ChecklistItem"("financialYear", "sortOrder");

-- CreateIndex
CREATE INDEX "ChecklistItem_templateId_idx" ON "ChecklistItem"("templateId");

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChecklistTemplateItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountReconciliation" ADD CONSTRAINT "AccountReconciliation_reconciledById_fkey" FOREIGN KEY ("reconciledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountNote" ADD CONSTRAINT "AccountNote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
