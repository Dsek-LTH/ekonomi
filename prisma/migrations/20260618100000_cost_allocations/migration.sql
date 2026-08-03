-- CreateTable: ExpenseCostAllocation
CREATE TABLE "ExpenseCostAllocation" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "costCenterId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    CONSTRAINT "ExpenseCostAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExpenseCostAllocation_expenseId_costCenterId_key"
    ON "ExpenseCostAllocation"("expenseId", "costCenterId");

CREATE INDEX "ExpenseCostAllocation_expenseId_idx"
    ON "ExpenseCostAllocation"("expenseId");

ALTER TABLE "ExpenseCostAllocation"
    ADD CONSTRAINT "ExpenseCostAllocation_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExpenseCostAllocation"
    ADD CONSTRAINT "ExpenseCostAllocation_costCenterId_fkey"
    FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ExpenseCostAllocation"
    ADD CONSTRAINT "ExpenseCostAllocation_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed one allocation per existing expense from its current costCenterId
INSERT INTO "ExpenseCostAllocation" ("id", "expenseId", "costCenterId", "amount")
SELECT 'alloc_' || "id", "id", "costCenterId", COALESCE("grossAmount", 0)
FROM "Expense";

-- Add COST_CENTER_APPROVED to ExpenseEventType
ALTER TYPE "ExpenseEventType" ADD VALUE IF NOT EXISTS 'COST_CENTER_APPROVED';

-- Migrate REJECTED → CHANGES_REQUESTED (data only; enum value stays in DB)
UPDATE "Expense" SET "status" = 'CHANGES_REQUESTED' WHERE "status" = 'REJECTED';

-- Drop costCenterId from Expense
DROP INDEX IF EXISTS "Expense_costCenterId_idx";
ALTER TABLE "Expense" DROP COLUMN "costCenterId";
