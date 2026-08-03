-- CreateEnum
CREATE TYPE "BudgetChangeKind" AS ENUM ('AVSTEG', 'FORFLYTTNING');

-- CreateTable
CREATE TABLE "BudgetChange" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "BudgetChangeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "BudgetChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetAdjustment" (
    "id" TEXT NOT NULL,
    "changeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BudgetAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetChange_budgetId_idx" ON "BudgetChange"("budgetId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetChange_budgetId_seq_key" ON "BudgetChange"("budgetId", "seq");

-- CreateIndex
CREATE INDEX "BudgetAdjustment_changeId_idx" ON "BudgetAdjustment"("changeId");

-- CreateIndex
CREATE INDEX "BudgetAdjustment_accountId_idx" ON "BudgetAdjustment"("accountId");

-- AddForeignKey
ALTER TABLE "BudgetChange" ADD CONSTRAINT "BudgetChange_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetChange" ADD CONSTRAINT "BudgetChange_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetChange" ADD CONSTRAINT "BudgetChange_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAdjustment" ADD CONSTRAINT "BudgetAdjustment_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "BudgetChange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetAdjustment" ADD CONSTRAINT "BudgetAdjustment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "BudgetAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
